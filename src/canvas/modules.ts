import type { CanvasCourse } from "./client.js";

const MODULE_CODE_PATTERN = /\b[A-Z]{2,4}\d{4}[A-Z]{0,3}\b/g;

export function normaliseModuleCode(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

// NUS course names and codes embed the module code, sometimes several for
// cross-listed modules, e.g. "CS2103T/CS2103R Software Engineering".
export function moduleCodesFor(course: CanvasCourse): string[] {
  const text = `${course.course_code ?? ""} ${course.name ?? ""}`.toUpperCase();
  return [...new Set(text.match(MODULE_CODE_PATTERN) ?? [])];
}

export function primaryModuleCode(course: CanvasCourse): string {
  return moduleCodesFor(course)[0] ?? course.course_code ?? course.name;
}

export function findCoursesByModule(
  courses: CanvasCourse[],
  moduleCode: string,
): CanvasCourse[] {
  const wanted = normaliseModuleCode(moduleCode);
  if (!wanted) return [];

  const exact = courses.filter((course) =>
    moduleCodesFor(course).includes(wanted),
  );
  if (exact.length > 0) return exact;

  return courses.filter((course) =>
    normaliseModuleCode(`${course.course_code} ${course.name}`).includes(
      wanted,
    ),
  );
}
