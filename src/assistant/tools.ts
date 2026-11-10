import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";
import {
  CanvasAuthError,
  CanvasRequestError,
  type CanvasClient,
  type CanvasCourse,
} from "../canvas/client.js";
import {
  findCoursesByModule,
  moduleCodesFor,
  primaryModuleCode,
} from "../canvas/modules.js";
import {
  formatBytes,
  formatDueItemsByModule,
  isWithinDays,
  type DueItem,
} from "./format.js";
import {
  botActionTools,
  BotToolError,
  executeBotActionTool,
  isBotActionTool,
  type BotActions,
  type UndoRef,
} from "./bot-tools.js";
import {
  MAX_FILES_PER_SEND,
  sendCanvasFiles,
  type FileDelivery,
} from "./file-sender.js";
import type { TelegramFileCache } from "./store.js";
import {
  MAX_READ_BYTES,
  describeDocument,
  readDocument,
  type DocumentContent,
} from "./documents.js";

type PageImage = DocumentContent["images"][number];
const MAX_FILES_PER_READ = 3;
export const MAX_IMAGES_PER_REQUEST = 8;

export type { FileDelivery } from "./file-sender.js";

const MAX_FILE_RESULTS = 25;

// Expected problems the model should explain to the user in its own reply.
export class AssistantToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantToolError";
  }
}

const canvasTools: ChatCompletionFunctionTool[] = [
  {
    type: "function",
    function: {
      name: "list_modules",
      description: "List the user's active Canvas modules (courses).",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_upcoming_assignments",
      description:
        "List assignments due soon, grouped by module and sorted by due date in Singapore time. The result is already formatted for the user.",
      parameters: {
        type: "object",
        properties: {
          module_code: {
            type: "string",
            description: "Optional NUS module code, e.g. CS2102.",
          },
          days_ahead: {
            type: "integer",
            description: "How many days ahead to look (1-60, default 7).",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description:
        "Search a module's Canvas files by file or folder name. Pass every item the user asked for in one call, e.g. queries ['lecture 10', 'lecture 11']. 'lecture 10' also finds names like 'L10' or 'Lec 10'. Returns file ids for send_files.",
      parameters: {
        type: "object",
        properties: {
          module_code: { type: "string", description: "e.g. CS2103T" },
          queries: {
            type: "array",
            items: { type: "string" },
            description: "1-5 searches, e.g. ['lecture 10', 'tutorial 3'].",
          },
        },
        required: ["module_code", "queries"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_files",
      description:
        "Send 1-10 Canvas files to the user in Telegram by their ids. Several files arrive together as one message.",
      parameters: {
        type: "object",
        properties: {
          file_ids: {
            type: "array",
            items: { type: "integer" },
            description: "ids from search_files.",
          },
        },
        required: ["file_ids"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_files",
      description:
        "Read 1-3 Canvas files (PDF, PowerPoint, Word, text, code, images) to answer or solve questions about their content, including files you just sent. Returns the text; for PDFs, images of the pages (the first 6, or the pages asked for) are attached so formulas, tables and diagrams can be seen.",
      parameters: {
        type: "object",
        properties: {
          file_ids: {
            type: "array",
            items: { type: "integer" },
            description: "ids from search_files or earlier tool_data.",
          },
          pages: {
            type: "string",
            description: "Optional PDF pages to show as images, e.g. '3-5'.",
          },
        },
        required: ["file_ids"],
        additionalProperties: false,
      },
    },
  },
];

export const assistantTools: ChatCompletionFunctionTool[] = [
  ...canvasTools,
  ...botActionTools,
];

// Optional integrations; their tools are offered only when set up.
export interface AssistantFeatures {
  canvas: boolean;
  calendar: boolean;
}

export const ALL_FEATURES: AssistantFeatures = { canvas: true, calendar: true };

const CANVAS_TOOL_NAMES = new Set(canvasTools.map((t) => t.function.name));
const CALENDAR_TOOL_NAMES = new Set([
  "create_calendar_event",
  "list_calendar_events",
  "delete_calendar_event",
]);

export function toolsFor(
  features: AssistantFeatures,
): ChatCompletionFunctionTool[] {
  return assistantTools.filter(
    (t) =>
      (features.canvas || !CANVAS_TOOL_NAMES.has(t.function.name)) &&
      (features.calendar || !CALENDAR_TOOL_NAMES.has(t.function.name)),
  );
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AssistantToolError(
      "The tool arguments were not valid JSON. Retry with a JSON object.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AssistantToolError("The tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function stringArg(
  args: Record<string, unknown>,
  name: string,
  required: boolean,
): string | undefined {
  const value = args[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (required) throw new AssistantToolError(`Missing "${name}".`);
  return undefined;
}

function integerArg(
  args: Record<string, unknown>,
  name: string,
): number | undefined {
  const value = args[name];
  const number = typeof value === "string" ? Number(value) : value;
  if (number === undefined || number === null || number === "")
    return undefined;
  if (typeof number !== "number" || !Number.isSafeInteger(number)) {
    throw new AssistantToolError(`"${name}" must be an integer.`);
  }
  return number;
}

function normaliseSearchText(value: string): string {
  // "Week 03" and "week3" should both match "week 3".
  return value
    .toLowerCase()
    .replace(/(\d+)/g, (digits) => String(Number(digits)))
    .replace(/[\s_-]+/g, "");
}

const MAX_SEARCH_QUERIES = 5;

// Each kind: how users write it, its spellings in file names, the stem Canvas
// is searched with (it matches every long spelling) and the one-letter form.
const NUMBERED_KINDS: Array<{
  pattern: RegExp;
  spellings: string;
  stem: string;
  letter?: string;
}> = [
  {
    pattern: /^(lectures?|lect|lec|l)$/i,
    spellings: "lecture|lect|lec|l",
    stem: "lec",
    letter: "l",
  },
  {
    pattern: /^(tutorials?|tut|t)$/i,
    spellings: "tutorial|tut|t",
    stem: "tut",
    letter: "t",
  },
  { pattern: /^(labs?)$/i, spellings: "lab", stem: "lab" },
  {
    pattern: /^(weeks?|wk|w)$/i,
    spellings: "week|wk|w",
    stem: "week",
    letter: "w",
  },
];

export interface SearchPlan {
  // Terms sent to Canvas's name search.
  terms: string[];
  // Whether a file name Canvas returned is a real match for the request.
  fileMatches: (name: string) => boolean;
  // Whether every file in a folder with this name or path should be included.
  folderMatches: (name: string, path: string) => boolean;
}

// Canvas search matches file names literally, so "lecture 10" alone misses
// "L10 (annotated).pdf". Numbered requests search the stem and the letter
// form, then keep only names with that exact number ("L1" is not "L10").
export function searchPlan(query: string): SearchPlan {
  // Found anywhere in the query, so "lecture 10 slides" works like "lecture 10".
  const match =
    /(?:^|[^a-z0-9])(lectures?|lect|lec|l|tutorials?|tut|t|labs?|weeks?|wk|w)\.?\s*0*(\d{1,3})(?!\d)/i.exec(
      query.trim(),
    );
  const kind =
    match && NUMBERED_KINDS.find((entry) => entry.pattern.test(match[1]));
  if (!match || !kind) {
    const wanted = normaliseSearchText(query);
    return {
      terms: [query],
      fileMatches: () => true,
      folderMatches: (_name, path) =>
        normaliseSearchText(path).includes(wanted),
    };
  }

  const number = match[2];
  const terms = [kind.stem];
  if (kind.letter) {
    terms.push(`${kind.letter}${number}`);
    if (number.length === 1) terms.push(`${kind.letter}0${number}`);
  }
  const exact = new RegExp(
    // One word may sit in between: "Tutorial Week 10", "Lecture Notes 10".
    `(^|[^a-z0-9])(${kind.spellings})s?(?![a-z])[\\s._-]*(?:[a-z]+[\\s._-]+)?0*${number}(?!\\d)`,
    "i",
  );
  return {
    terms,
    fileMatches: (name) => exact.test(name),
    folderMatches: (name) => exact.test(name),
  };
}

export class AssistantToolbox {
  private coursesCache?: Promise<CanvasCourse[]>;
  // Changes made during this run, offered as Undo buttons on the reply.
  readonly undo: UndoRef[] = [];
  // Page images from read_files, handed to the model after the tool results.
  private pendingImages: PageImage[] = [];
  private imagesShown = 0;

  takeImages(): PageImage[] {
    const images = this.pendingImages;
    this.pendingImages = [];
    return images;
  }

  constructor(
    private readonly canvas: CanvasClient | undefined,
    private readonly delivery: FileDelivery,
    private readonly now: () => Date = () => new Date(),
    private readonly actions?: BotActions,
    private readonly fileCache?: TelegramFileCache,
  ) {}

  private get canvasClient(): CanvasClient {
    if (!this.canvas) {
      throw new AssistantToolError("Canvas isn't set up for this bot.");
    }
    return this.canvas;
  }

  private courses(): Promise<CanvasCourse[]> {
    this.coursesCache ??= this.canvasClient.listActiveCourses();
    return this.coursesCache;
  }

  private async coursesFor(moduleCode: string): Promise<CanvasCourse[]> {
    const matches = findCoursesByModule(await this.courses(), moduleCode);
    if (matches.length === 0) {
      throw new AssistantToolError(
        `No active Canvas module matches "${moduleCode}". Call list_modules to see the available modules.`,
      );
    }
    return matches;
  }

  // Returns the text handed back to the model. Expected failures become an
  // error string so the model can explain them; an expired token is fatal.
  async execute(name: string, rawArguments: string): Promise<string> {
    try {
      const args = parseToolArguments(rawArguments);
      if (isBotActionTool(name)) {
        if (!this.actions) {
          throw new AssistantToolError(`"${name}" is not available here.`);
        }
        return await executeBotActionTool(name, args, this.actions, this.undo);
      }
      switch (name) {
        case "list_modules":
          return await this.listModules();
        case "list_upcoming_assignments":
          return await this.listUpcomingAssignments(args);
        case "search_files":
          return await this.searchFiles(args);
        case "read_files":
          return await this.readFiles(args);
        case "send_files":
          return await this.sendFiles(args);
        default:
          throw new AssistantToolError(`Unknown tool "${name}".`);
      }
    } catch (error) {
      if (error instanceof CanvasAuthError) throw error;
      if (
        error instanceof AssistantToolError ||
        error instanceof BotToolError
      ) {
        return `Error: ${error.message}`;
      }
      if (error instanceof CanvasRequestError) {
        return error.status === 401 || error.status === 403
          ? "Error: Canvas does not allow access to this (the module may hide its Files page)."
          : `Error: ${error.message}`;
      }
      throw error;
    }
  }

  private async listModules(): Promise<string> {
    const courses = await this.courses();
    if (courses.length === 0) return "No active Canvas modules.";
    return courses
      .map(
        (course) =>
          `${moduleCodesFor(course).join("/") || "?"} — ${course.name}`,
      )
      .join("\n");
  }

  private async listUpcomingAssignments(
    args: Record<string, unknown>,
  ): Promise<string> {
    const moduleCode = stringArg(args, "module_code", false);
    const daysAhead = Math.min(
      Math.max(integerArg(args, "days_ahead") ?? 7, 1),
      60,
    );
    const courses = moduleCode
      ? await this.coursesFor(moduleCode)
      : await this.courses();
    const now = this.now();

    const perCourse = await Promise.all(
      courses.map(async (course) => {
        const assignments = await this.canvasClient
          .listFutureAssignments(course.id)
          .catch((error: unknown) => {
            // One module with assignments hidden should not hide the rest.
            if (error instanceof CanvasRequestError && !moduleCode) return [];
            throw error;
          });
        return assignments
          .filter((a) => a.due_at && isWithinDays(a.due_at, now, daysAhead))
          .map((a): DueItem => ({
            moduleCode: primaryModuleCode(course),
            name: a.name,
            dueAt: a.due_at!,
            submitted: Boolean(a.submission?.submitted_at),
          }));
      }),
    );
    return formatDueItemsByModule(perCourse.flat(), daysAhead);
  }

  private async searchFiles(args: Record<string, unknown>): Promise<string> {
    const moduleCode = stringArg(args, "module_code", true)!;
    const rawQueries = Array.isArray(args.queries)
      ? args.queries
      : [stringArg(args, "query", true)];
    const queries = [
      ...new Set(
        rawQueries
          .filter((q): q is string => typeof q === "string" && q.trim() !== "")
          .map((q) => q.trim()),
      ),
    ];
    if (queries.length === 0)
      throw new AssistantToolError('Missing "queries".');
    if (queries.length > MAX_SEARCH_QUERIES) {
      throw new AssistantToolError(
        `At most ${MAX_SEARCH_QUERIES} searches per call.`,
      );
    }
    const courses = await this.coursesFor(moduleCode);

    // Each course's folder list is fetched once; every query's name searches
    // and folder listings run in parallel.
    const perCourse = await Promise.all(
      courses.map(async (course) => {
        const folders = await this.canvasClient.listFolders(course.id);
        const folderNames = new Map(
          folders.map((f) => [
            f.id,
            f.full_name.replace(/^course files\/?/, "") || "/",
          ]),
        );
        const perQuery = await Promise.all(
          queries.map(async (query) => {
            const { terms, fileMatches, folderMatches } = searchPlan(query);
            const byName = (
              await Promise.all(
                terms
                  .filter((term) => term.length >= 2)
                  .map((term) =>
                    this.canvasClient.searchFiles(course.id, term),
                  ),
              )
            )
              .flat()
              .filter((file) => fileMatches(file.display_name));
            // Canvas search only looks at file names, so also take every file
            // in folders whose own name matches (e.g. a "Week 3" folder).
            const matchingFolders = folders
              .filter((f) => folderMatches(f.name, f.full_name))
              .slice(0, 5);
            const byFolder = (
              await Promise.all(
                matchingFolders.map((f) =>
                  this.canvasClient.listFolderFiles(f.id),
                ),
              )
            ).flat();
            return [...byName, ...byFolder];
          }),
        );
        return { folderNames, perQuery };
      }),
    );

    // Numbering runs across all queries so follow-ups like "send the second
    // one" stay unambiguous.
    const seen = new Set<number>();
    const sections: string[] = [];
    let number = 0;
    let found = 0;
    queries.forEach((query, queryIndex) => {
      const lines: string[] = [];
      for (const { folderNames, perQuery } of perCourse) {
        for (const file of perQuery[queryIndex]) {
          if (seen.has(file.id) || found >= MAX_FILE_RESULTS) continue;
          seen.add(file.id);
          found += 1;
          number += 1;
          lines.push(
            `${number}. id=${file.id} | ${file.display_name} | ${formatBytes(file.size)} | folder: ${folderNames.get(file.folder_id) ?? "/"}`,
          );
        }
      }
      const heading = queries.length > 1 ? `"${query}":\n` : "";
      sections.push(
        lines.length > 0
          ? `${heading}${lines.join("\n")}`
          : `"${query}": no matching files in ${moduleCode}.`,
      );
    });

    if (found === 0) {
      throw new AssistantToolError(
        `No files in ${moduleCode} match ${queries.map((q) => `"${q}"`).join(", ")}. Don't search again with other spellings; tell the user.`,
      );
    }
    return sections.join("\n\n");
  }

  private async readFiles(args: Record<string, unknown>): Promise<string> {
    const raw = args.file_ids;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new AssistantToolError('"file_ids" must be a list of file ids.');
    }
    const ids = [...new Set(raw.map((value) => Number(value)))];
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new AssistantToolError('"file_ids" must be positive integers.');
    }
    if (ids.length > MAX_FILES_PER_READ) {
      throw new AssistantToolError(
        `Read at most ${MAX_FILES_PER_READ} files at a time.`,
      );
    }
    const pages = stringArg(args, "pages", false);

    const parts: string[] = [];
    for (const id of ids) {
      const file = await this.canvasClient.getFile(id);
      if (file.size > MAX_READ_BYTES) {
        parts.push(
          `File: ${file.display_name}\nNote: too large to read (over 25 MB).`,
        );
        continue;
      }
      const content = await readDocument(
        file.display_name || file.filename,
        await this.canvasClient.downloadFile(file),
        { mimeType: file["content-type"], pages },
      );
      // Cap images across the whole request to keep it fast.
      const room = Math.max(0, MAX_IMAGES_PER_REQUEST - this.imagesShown);
      const images = content.images.slice(0, room);
      this.imagesShown += images.length;
      this.pendingImages.push(...images);
      parts.push(describeDocument({ ...content, images }));
    }
    return parts.join("\n\n=====\n\n");
  }

  private async sendFiles(args: Record<string, unknown>): Promise<string> {
    const raw =
      args.file_ids ??
      (args.file_id !== undefined ? [args.file_id] : undefined);
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new AssistantToolError('"file_ids" must be a list of file ids.');
    }
    const ids = [...new Set(raw.map((value) => Number(value)))];
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new AssistantToolError('"file_ids" must be positive integers.');
    }
    if (ids.length > MAX_FILES_PER_SEND) {
      throw new AssistantToolError(
        `At most ${MAX_FILES_PER_SEND} files can be sent at once.`,
      );
    }
    return sendCanvasFiles(ids, {
      canvas: this.canvasClient,
      delivery: this.delivery,
      cache: this.fileCache,
    });
  }
}
