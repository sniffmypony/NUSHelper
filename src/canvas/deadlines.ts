import { canvasConfig, isCanvasConfigured } from "../env.js";
import { formatDueTime, type DueItem } from "../assistant/format.js";
import {
  CanvasClient,
  CanvasRequestError,
  type CanvasAssignment,
  type CanvasCourse,
} from "./client.js";
import { primaryModuleCode } from "./modules.js";

// Canvas deadlines, used by the assistant's list_upcoming_assignments and by
// the morning message and weekly digest. In the scheduled messages Canvas is
// optional and can be down: either way the rest of the message still sends.

export interface DeadlineSource {
  listActiveCourses(): Promise<CanvasCourse[]>;
  listFutureAssignments(courseId: number): Promise<CanvasAssignment[]>;
}

// Assignments in these courses due from `from` up to `until`, earliest
// first. A module whose assignments Canvas refuses is skipped, unless
// `strict` (one named module, where that refusal is the answer).
export async function fetchDueItems(
  source: Pick<DeadlineSource, "listFutureAssignments">,
  courses: CanvasCourse[],
  from: Date,
  until: Date,
  { strict = false }: { strict?: boolean } = {},
): Promise<DueItem[]> {
  const perCourse = await Promise.all(
    courses.map(async (course) => {
      const assignments = await source
        .listFutureAssignments(course.id)
        .catch((error: unknown) => {
          if (error instanceof CanvasRequestError && !strict) return [];
          throw error;
        });
      return assignments
        .filter((assignment) => {
          if (!assignment.due_at) return false;
          const due = Date.parse(assignment.due_at);
          return due >= from.getTime() && due <= until.getTime();
        })
        .map((assignment): DueItem => ({
          moduleCode: primaryModuleCode(course),
          name: assignment.name,
          dueAt: assignment.due_at!,
          submitted: Boolean(assignment.submission?.submitted_at),
        }));
    }),
  );
  return perCourse
    .flat()
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

export function formatDeadlineSection(
  title: string,
  items: DueItem[],
): string | null {
  if (items.length === 0) return null;
  return [
    title,
    ...items.map(
      (item) =>
        `• ${formatDueTime(item.dueAt)} — ${item.moduleCode}: ${item.name}${item.submitted ? " ✅ submitted" : ""}`,
    ),
  ].join("\n");
}

export type DeadlineSectionResult = { text: string | null; failed: boolean };

export async function canvasDeadlineSection(
  title: string,
  from: Date,
  until: Date,
  options: { includeSubmitted: boolean },
  source?: DeadlineSource,
): Promise<DeadlineSectionResult> {
  if (!source && !isCanvasConfigured()) return { text: null, failed: false };
  try {
    const config = source ? null : canvasConfig();
    const client = source ?? new CanvasClient(config!.baseUrl, config!.token);
    const items = await fetchDueItems(
      client,
      await client.listActiveCourses(),
      from,
      until,
    );
    return {
      text: formatDeadlineSection(
        title,
        options.includeSubmitted
          ? items
          : items.filter((item) => !item.submitted),
      ),
      failed: false,
    };
  } catch (error) {
    const type = error instanceof Error ? error.name : typeof error;
    console.error(`Canvas deadline check failed (${type})`);
    return { text: null, failed: true };
  }
}
