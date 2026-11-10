// How hard the model thinks (the OpenAI-style reasoning_effort parameter).
// Bot actions and chat need little thought; study problems need more. A level
// that runs out of time falls back to the next lower one.

export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];
export type EffortSetting = Effort | "auto";

// One message may use this much time in total. Vercel stops the function at
// 300 seconds; the rest is left for downloading files and sending the reply.
export const ASSISTANT_BUDGET_MS = 270_000;

// The most each level may use when a lower level still has to fit after it.
// The last level tried always gets whatever time is left.
const ATTEMPT_LIMIT_MS: Record<Effort, Record<Effort, number>> = {
  // Starting level -> limit for each level in its fallback chain.
  low: { low: ASSISTANT_BUDGET_MS, medium: 0, high: 0 },
  medium: { low: ASSISTANT_BUDGET_MS, medium: 165_000, high: 0 },
  high: { low: ASSISTANT_BUDGET_MS, medium: 85_000, high: 135_000 },
};

export function isEffortSetting(value: string): value is EffortSetting {
  return value === "auto" || (EFFORTS as readonly string[]).includes(value);
}

// "high" -> ["high", "medium", "low"]: the levels to try, in order.
export function fallbackChain(start: Effort): Effort[] {
  return EFFORTS.slice(0, EFFORTS.indexOf(start) + 1).reverse();
}

export function attemptLimitMs(
  start: Effort,
  level: Effort,
  remainingMs: number,
): number {
  const isLast = level === "low";
  return isLast
    ? remainingMs
    : Math.min(ATTEMPT_LIMIT_MS[start][level], remainingMs);
}

// Words and shapes that mark a study problem rather than a bot action.
const STUDY_CUES =
  /\b(solve|prove|proof|derive|explain|why|calculate|compute|evaluate|simplify|integrate|differentiate|show that|find (all|the|one|a)\b|minimal cover|candidate keys?|normal form|bcnf|3nf|complexity|algorithm|recurrence|theorem|lemma|q\d+|question \d+|part \(?[a-h]\)?)/i;
const MATH_SHAPES = /[=^√∑∫≤≥≠→∀∃]|\$|\\[a-z]+|\d\s*[+\-*/]\s*\d/;

// A photo or file, or text that reads like a question to work through.
export function isStudyRequest(text: string, hasAttachment: boolean): boolean {
  if (hasAttachment) return true;
  return STUDY_CUES.test(text) || MATH_SHAPES.test(text) || text.length > 280;
}

export function chooseEffort(
  setting: EffortSetting,
  text: string,
  hasAttachment: boolean,
): Effort {
  if (setting !== "auto") return setting;
  return isStudyRequest(text, hasAttachment) ? "medium" : "low";
}

export const EFFORT_HELP = [
  "/effort auto — low for bot actions, medium for study questions (default)",
  "/effort low | medium | high — use that level for every message",
].join("\n");

export function describeEffortSetting(setting: EffortSetting): string {
  return setting === "auto"
    ? "Thinking effort: auto (low for bot actions, medium for study questions)."
    : `Thinking effort: ${setting} for every message.`;
}

export function fallbackNote(used: Effort, first: Effort): string {
  return `_Answered with ${used} thinking because ${first} took too long._`;
}
