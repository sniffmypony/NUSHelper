import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";

// Streams completions and returns the assembled message. Streaming shows the
// model is still working, so a long think is not mistaken for a hang: the call
// only fails when nothing arrives for IDLE_TIMEOUT_MS, or the caller's time
// limit (signal) is reached.

const IDLE_TIMEOUT_MS = 60_000;

export class ModelTimeoutError extends Error {
  constructor() {
    super("The model took too long to respond");
    this.name = "ModelTimeoutError";
  }
}

export interface CompletionOptions {
  // Aborted when this attempt's time is up.
  signal?: AbortSignal;
}

type StreamingClient = Pick<OpenAI, "chat">;

// Some providers or models reject reasoning_effort. After the first rejection
// it is no longer sent, so the bot keeps working at the model's default.
let effortUnsupported = false;

export function resetEffortSupportForTests(): void {
  effortUnsupported = false;
}

function rejectsEffort(error: unknown): boolean {
  return (
    error instanceof OpenAI.APIError &&
    (error.status === 400 || error.status === 422) &&
    /reasoning/i.test(error.message)
  );
}

export async function streamCompletion(
  client: StreamingClient,
  body: ChatCompletionCreateParamsNonStreaming,
  options: CompletionOptions = {},
  idleTimeoutMs = IDLE_TIMEOUT_MS,
): Promise<ChatCompletion> {
  if (options.signal?.aborted) throw new ModelTimeoutError();
  const request = { ...body };
  if (effortUnsupported) delete request.reasoning_effort;
  try {
    return await collect(client, request, options.signal, idleTimeoutMs);
  } catch (error) {
    if (request.reasoning_effort && rejectsEffort(error)) {
      effortUnsupported = true;
      console.error(
        "The model rejected reasoning_effort; continuing without it",
      );
      delete request.reasoning_effort;
      return collect(client, request, options.signal, idleTimeoutMs);
    }
    throw error;
  }
}

async function collect(
  client: StreamingClient,
  body: ChatCompletionCreateParamsNonStreaming,
  signal: AbortSignal | undefined,
  idleTimeoutMs: number,
): Promise<ChatCompletion> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => {
    timedOut = true;
    controller.abort();
  };
  signal?.addEventListener("abort", abort, { once: true });
  let idle = setTimeout(abort, idleTimeoutMs);
  const alive = () => {
    clearTimeout(idle);
    idle = setTimeout(abort, idleTimeoutMs);
  };

  let content = "";
  let finishReason: ChatCompletion.Choice["finish_reason"] = "stop";
  let id = "";
  let model = body.model;
  const calls: ChatCompletionMessageFunctionToolCall[] = [];
  try {
    const stream = (await client.chat.completions.create(
      { ...body, stream: true },
      { signal: controller.signal },
    )) as AsyncIterable<ChatCompletionChunk>;
    for await (const chunk of stream) {
      alive();
      id ||= chunk.id;
      model = chunk.model || model;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta ?? {};
      if (delta.content) content += delta.content;
      for (const part of delta.tool_calls ?? []) {
        const call = (calls[part.index] ??= {
          id: "",
          type: "function",
          function: { name: "", arguments: "" },
        });
        if (part.id) call.id = part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) {
          call.function.arguments += part.function.arguments;
        }
      }
    }
  } catch (error) {
    if (timedOut) throw new ModelTimeoutError();
    throw error;
  } finally {
    clearTimeout(idle);
    signal?.removeEventListener("abort", abort);
  }
  if (timedOut) throw new ModelTimeoutError();

  const toolCalls = calls.filter(Boolean);
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        logprobs: null,
        message: {
          role: "assistant",
          content: content || null,
          refusal: null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
  };
}
