import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { DateTime } from "luxon";
import { SINGAPORE_TIME_ZONE } from "../dates.js";
import { cleanModelText, looksLikeToolMarkup } from "./format.js";
import { ALL_FEATURES, toolsFor, type AssistantFeatures } from "./tools.js";

export const MAX_TOOL_ITERATIONS = 5;
// Tool output kept with the reply so follow-ups ("send the second one") can resolve ids.
const MAX_TOOL_CONTEXT_CHARS = 3000;

export type CreateCompletion = (
  body: ChatCompletionCreateParamsNonStreaming,
) => Promise<ChatCompletion>;

export type ExecuteTool = (
  name: string,
  rawArguments: string,
) => Promise<string>;

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
  toolContext?: string | null;
}

export interface AssistantTimings {
  modelMs: number;
  modelCalls: number;
  tools: Array<{ name: string; ms: number }>;
}

export type ReplyFormat = "markdown" | "plain";

export interface AssistantResult {
  reply: string;
  format: ReplyFormat;
  toolContext: string;
  timings: AssistantTimings;
}

const EXPENDITURE_REPORT_TOOLS = new Set([
  "expenditure_breakdown",
  "expenditure_report",
]);

// These results are the reply. After a send, asking the model again would only
// add a round trip; spending figures must reach the user exactly, since the
// model has been seen inventing a total when summarising a report.
function isDirectReply(name: string, output: string): boolean {
  if (name === "send_files") return output.startsWith("Sent ");
  return EXPENDITURE_REPORT_TOOLS.has(name) && !output.startsWith("Error:");
}

const MAX_MARKUP_RETRIES = 2;
// search_files reports an item without results as `"lecture 11": no matching files in CS2102.`
const MISSING_SEARCH_LINE = /^"(.+)": no matching files in (\S+)\.$/gm;
export const UNPROCESSED_REPLY =
  "Sorry, I couldn't process that request just now. Please try again.";

export const NOT_SENT_NOTE =
  "I didn't manage to send the file this time. Please ask again.";

// A reply line claiming "Sent …" when nothing was sent in this run is the
// model guessing. Drop those lines and say plainly that nothing was sent.
export function withoutFalseSendClaims(
  reply: string,
  filesSent: boolean,
): string {
  if (filesSent || !/^\s*sent\b/im.test(reply)) return reply;
  const rest = reply
    .split("\n")
    .filter((line) => !/^\s*sent\b/i.test(line))
    .join("\n")
    .trim();
  return rest ? `${NOT_SENT_NOTE}\n\n${rest}` : NOT_SENT_NOTE;
}

function notSetUp(features: AssistantFeatures): string[] {
  const missing = [
    ...(features.canvas ? [] : ["Canvas"]),
    ...(features.calendar ? [] : ["Google Calendar"]),
  ];
  return missing.length
    ? [
        `Not set up on this bot: ${missing.join(" and ")}. If asked, say it isn't set up yet rather than that it doesn't exist.`,
      ]
    : [];
}

export function systemPrompt(
  now: Date,
  features: AssistantFeatures = ALL_FEATURES,
): string {
  const today = DateTime.fromJSDate(now)
    .setZone(SINGAPORE_TIME_ZONE)
    .toFormat("cccc d LLLL yyyy, HH:mm");
  return [
    "You are a concise assistant inside a private Telegram bot for an NUS student.",
    `It is now ${today} (Asia/Singapore).`,
    "The bot's features, all of which you have tools for:",
    ...(features.canvas
      ? [
          "- Canvas: active modules, upcoming assignments, searching and sending module files.",
        ]
      : []),
    "- Long-term tasks (/task, /list, /done, /remove): add, list, mark done, delete.",
    "- Today's to-do list (/todo, /todos): add, list, delete. Cleared every night. To-dos cannot be marked done, only deleted.",
    "- Same-day reminders (/remind HHMM): set, list, cancel. Only for later today.",
    ...(features.calendar
      ? [
          "- Google Calendar: propose new events (user presses Create), list events, delete events (user presses Delete).",
        ]
      : []),
    "- Daily expenditure in S$: add or remove amounts for a day, weekly and monthly reports, and a day-by-day breakdown for any date range (expenditure_breakdown). The user can also just send numbers like '5 3.9' to log today's spending, and gets an 'expenditure:' prompt at 11:30pm. Only each day's total is stored, not individual purchases.",
    "Besides these features, answer study questions (maths, computer science, proofs, algorithms, code, concepts) directly from your own knowledge, with clear working and no tool calls.",
    ...notSetUp(features),
    "Never say a feature above doesn't exist. If something is neither one of these features nor a study question, say in one line that the bot can't do it.",
    "Never create, change or delete anything based on a guess. If the request is unclear (which item, what amount, what time or date, or whether the user means a to-do, task or expenditure), ask one short question and call no tools.",
    "Only say something was added, set, completed or logged when a tool result confirms it; then include that confirmation text as-is. Deletions only send a confirmation button: say the user needs to press Delete.",
    "For a reminder on another day, call no tools: say reminders only work for later today and offer a task with that due date or a calendar event.",
    "Times are Singapore time; resolve today, tomorrow, Friday and so on from the current date. For past records such as spending, a date with no year means its most recent occurrence that isn't in the future.",
    "Keep replies to about three short lines unless showing a list or working through a problem. Don't offer lists of alternatives unless asked.",
    "The user may send a photo, with or without a caption:",
    "- A note or instruction meant for this bot (e.g. 'add a reminder at 10pm to do laundry'): carry it out with the tools exactly as if it had been typed.",
    "- A problem or question (maths, proofs, code, exercises): solve it with clear, step-by-step working. Follow the caption if it narrows the task (e.g. 'just part b').",
    "- Anything else (posters, screenshots, slides): say briefly what it shows and ask what the user wants. Never create tasks, reminders, events or expenditure from it unless the caption asks.",
    "- If the image is unreadable, say so and ask for a clearer photo.",
    "When a tool result says a message or buttons were already sent to the user, don't repeat that text; reply with one short line at most.",
    "When list_upcoming_assignments returns a formatted list, reply with that list as-is (you may add one short line).",
    "To send files: call search_files ONCE with every requested item in queries (e.g. ['lecture 10', 'lecture 11']), then call send_files ONCE with all the files found, then say in one line which items had no file. Search already tries spellings like L10 and Lec 10, so never search again for an item that wasn't found. If several files match one item equally well, list them numbered (name and size) and ask which one.",
    "Never say a file was sent unless send_files returned 'Sent'.",
    "If a tool returns an error, explain it briefly in plain words.",
    "Format replies in Markdown: **bold**, lists, `code` and code blocks. No headings in short replies.",
    "Write all mathematics in LaTeX: $...$ inline and $$...$$ on its own line for display (Telegram renders both). Never use a bare $ for money; write amounts as S$5.00.",
    "Earlier assistant messages may contain <tool_data> blocks; use them to resolve follow-ups but never show them.",
  ].join("\n");
}

export function historyToMessages(
  turns: AssistantTurn[],
): ChatCompletionMessageParam[] {
  return turns.map((turn) =>
    turn.role === "user"
      ? { role: "user", content: turn.content }
      : {
          role: "assistant",
          content: turn.toolContext
            ? `${turn.content}\n\n<tool_data>\n${turn.toolContext}\n</tool_data>`
            : turn.content,
        },
  );
}

export const NO_CAPTION_TEXT = "(The user sent this photo with no caption.)";

export async function runAssistant(options: {
  create: CreateCompletion;
  model: string;
  history: AssistantTurn[];
  userText: string;
  // A photo the user sent, as a data URL; userText is then its caption.
  image?: string;
  // Optional integrations that are set up; defaults to all.
  features?: AssistantFeatures;
  execute: ExecuteTool;
  now?: Date;
}): Promise<AssistantResult> {
  const features = options.features ?? ALL_FEATURES;
  const tools = toolsFor(features);
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: systemPrompt(options.now ?? new Date(), features),
    },
    ...historyToMessages(options.history),
    options.image
      ? {
          role: "user",
          content: [
            { type: "text", text: options.userText || NO_CAPTION_TEXT },
            { type: "image_url", image_url: { url: options.image } },
          ],
        }
      : { role: "user", content: options.userText },
  ];
  const toolOutputs: string[] = [];
  const toolContext = () =>
    toolOutputs.join("\n").slice(-MAX_TOOL_CONTEXT_CHARS);
  const timings: AssistantTimings = { modelMs: 0, modelCalls: 0, tools: [] };
  const create: CreateCompletion = async (body) => {
    const started = Date.now();
    try {
      return await options.create(body);
    } finally {
      timings.modelMs += Date.now() - started;
      timings.modelCalls += 1;
    }
  };
  // Last line of defence: nothing that looks like tool markup is ever sent.
  // Model-written replies are Markdown (sent as rich messages); the bot's own
  // texts and direct tool results are sent as plain text.
  const result = (
    reply: string,
    format: ReplyFormat = "plain",
  ): AssistantResult => {
    if (looksLikeToolMarkup(reply)) {
      return {
        reply: UNPROCESSED_REPLY,
        format: "plain",
        toolContext: toolContext(),
        timings,
      };
    }
    const checked = withoutFalseSendClaims(reply, filesSent);
    return {
      reply: checked,
      format: checked === reply ? format : "plain",
      toolContext: toolContext(),
      timings,
    };
  };
  let markupRetries = 0;
  let filesSent = false;
  // Items a search found nothing for, repeated after a direct "Sent" reply.
  const notFound = new Set<string>();

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const completion = await create({
      model: options.model,
      messages,
      tools,
      tool_choice: "auto",
    });
    const message = completion.choices[0]?.message;
    if (!message) throw new Error("The model returned no message");

    const toolCalls = (message.tool_calls ?? []).filter(
      (call): call is ChatCompletionMessageFunctionToolCall =>
        call.type === "function",
    );
    if (toolCalls.length === 0) {
      if (looksLikeToolMarkup(message.content)) {
        // The model wrote its tool call as text. Ask again rather than
        // forwarding the markup; the retry usually comes back well formed.
        console.error("Model returned tool-call markup as text; retrying");
        if (++markupRetries <= MAX_MARKUP_RETRIES) continue;
        return result(UNPROCESSED_REPLY);
      }
      const reply = cleanModelText(message.content);
      return reply
        ? result(reply, "markdown")
        : result(fallbackReply(toolOutputs));
    }

    messages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: toolCalls,
    });
    const outputs: string[] = [];
    for (const call of toolCalls) {
      const started = Date.now();
      const output = await options.execute(
        call.function.name,
        call.function.arguments,
      );
      timings.tools.push({
        name: call.function.name,
        ms: Date.now() - started,
      });
      outputs.push(output);
      if (call.function.name === "send_files" && output.startsWith("Sent ")) {
        filesSent = true;
      }
      for (const missing of output.matchAll(MISSING_SEARCH_LINE)) {
        notFound.add(`No file found for "${missing[1]}" in ${missing[2]}.`);
      }
      toolOutputs.push(`[${call.function.name}]\n${output}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
    if (
      toolCalls.every((call, index) =>
        isDirectReply(call.function.name, outputs[index]),
      )
    ) {
      return result([...outputs, ...notFound].join("\n"));
    }
  }

  // Iteration cap reached: ask once more for an answer without tools, stating
  // plainly what did and did not happen so the model cannot claim a send.
  messages.push({
    role: "user",
    content: `(Automatic note from the bot: no more tool calls are possible for this message. ${
      filesSent
        ? "Only files a send_files result calls 'Sent' were sent."
        : "No files were sent."
    } In two lines at most, tell the user what you found and what to ask for next.)`,
  });
  try {
    const completion = await create({
      model: options.model,
      messages,
      tools,
      tool_choice: "none",
    });
    const reply = cleanModelText(completion.choices[0]?.message?.content);
    if (reply) return result(reply, "markdown");
  } catch {
    // Fall through to the generic reply below.
  }
  return result(fallbackReply(toolOutputs));
}

function fallbackReply(toolOutputs: string[]): string {
  const sent = toolOutputs.filter((output) =>
    output.startsWith("[send_files]\nSent"),
  );
  if (sent.length > 0) return "Done.";
  return "Sorry, I couldn't work that out. Try rephrasing or being more specific.";
}
