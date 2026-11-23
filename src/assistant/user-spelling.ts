// The assistant writes the text of reminders, tasks, to-dos, repeating items
// and calendar events itself, and can misspell a name the user typed
// ("ask iggy abt poll" became "Ask Igy about the poll"). It can't know how a
// name is spelled, so a capitalised word that is a near-miss of a word the
// user typed gets the user's spelling back. Ordinary words it tidied
// ("abt" -> "about") are left alone.

// The text field of each tool that saves something the user wrote.
export const USER_TEXT_FIELDS: Record<string, string> = {
  add_task: "description",
  add_todo: "description",
  set_reminder: "description",
  add_repeating: "description",
  create_calendar_event: "title",
};

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

// The user's word, with the assistant's capital first letter.
function withCapital(userWord: string, written: string): string {
  return written[0] === written[0].toUpperCase()
    ? userWord[0].toUpperCase() + userWord.slice(1)
    : userWord;
}

// The user word `written` is a misspelling of, if exactly one fits: same
// first letter, at least 3 letters, and 1 letter off (2 for words of 6+).
function misspelled(written: string, userWords: string[]): string | null {
  const lower = written.toLowerCase();
  let best: string | null = null;
  let bestDistance = Infinity;
  let tied = false;
  for (const word of userWords) {
    const candidate = word.toLowerCase();
    if (candidate.length < 3 || candidate[0] !== lower[0]) continue;
    const allowed = Math.max(candidate.length, lower.length) >= 6 ? 2 : 1;
    const distance = editDistance(lower, candidate);
    if (distance === 0 || distance > allowed) continue;
    if (distance < bestDistance) {
      best = word;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance && candidate !== best?.toLowerCase()) {
      tied = true;
    }
  }
  return tied ? null : best;
}

export function restoreUserSpelling(
  written: string,
  userText: string,
): { text: string; fixes: Array<[string, string]> } {
  const userWords = [...new Set(userText.match(WORD) ?? [])];
  const typed = new Set(userWords.map((word) => word.toLowerCase()));
  const fixes: Array<[string, string]> = [];
  let first = true;
  const text = written.replace(WORD, (word) => {
    // Every sentence starts with a capital, so the first word says nothing.
    if (first) {
      first = false;
      return word;
    }
    if (
      word[0] === word[0].toLowerCase() ||
      /\p{N}/u.test(word) ||
      typed.has(word.toLowerCase())
    ) {
      return word;
    }
    const original = misspelled(word, userWords);
    if (!original) return word;
    const restored = withCapital(original, word);
    fixes.push([word, restored]);
    return restored;
  });
  return { text, fixes };
}

// Tool arguments (JSON) with the user's spelling put back in the saved text.
export function keepUserSpelling(
  toolName: string,
  rawArguments: string,
  userText: string,
): string {
  const field = USER_TEXT_FIELDS[toolName];
  if (!field || !userText.trim()) return rawArguments;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArguments) as Record<string, unknown>;
  } catch {
    return rawArguments;
  }
  const value = args[field];
  if (typeof value !== "string") return rawArguments;
  const { text, fixes } = restoreUserSpelling(value, userText);
  if (fixes.length === 0) return rawArguments;
  // Counts only: the bot's logs never hold what the user wrote.
  console.log(
    `Restored the user's spelling of ${fixes.length} word${fixes.length === 1 ? "" : "s"} in ${toolName}`,
  );
  return JSON.stringify({ ...args, [field]: text });
}
