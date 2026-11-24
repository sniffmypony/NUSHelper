import { ApiError } from "../api";

// Website chat: types and the streamed reply.

export type CardState = "pending" | "done" | "cancelled" | "failed";

export interface ChatCard {
  type: "delete" | "undo" | "calendar-create" | "calendar-delete";
  label: string;
  state: CardState;
  result?: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  cards: ChatCard[];
  failed: boolean;
  createdAt: string;
}

export interface ChatSummary {
  id: number;
  title: string;
  pinned: boolean;
  updatedAt: string;
}

export type ChatEvent =
  | { type: "user"; message: ChatMessage }
  | { type: "status"; text: string }
  | { type: "draft"; text: string }
  | { type: "done"; message: ChatMessage; title: string }
  | { type: "error"; error: string };

export interface Upload {
  image?: string;
  file?: { name: string; mimeType: string; data: string };
}

// Sends a message and calls onEvent for each event of the reply as it
// arrives (newline-separated JSON).
export async function sendMessage(
  chatId: number,
  body: { text: string } & Upload,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const response = await fetch(`/api/web/chats/${chatId}/messages`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-NUSHelper": "1", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new ApiError(
      response.status,
      data.error ??
        (response.status === 413
          ? "That upload is too large."
          : `Request failed (${response.status})`),
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as ChatEvent);
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as ChatEvent);
}

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_PHOTO_SIDE = 1600;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("That file couldn't be read."));
    reader.readAsDataURL(blob);
  });
}

// Photos are shrunk to at most 1600 px and sent as JPEG; other files as
// they are (up to 3 MB). Nothing is kept on the server either way.
export async function prepareUpload(file: File): Promise<Upload> {
  if (/^image\/(jpeg|png|webp)$/.test(file.type)) {
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () =>
          reject(new Error("That photo couldn't be read."));
        element.src = url;
      });
      const scale = Math.min(
        1,
        MAX_PHOTO_SIDE / Math.max(image.naturalWidth, image.naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      canvas
        .getContext("2d")!
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      return { image: canvas.toDataURL("image/jpeg", 0.85) };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      "Files can be at most 3 MB here. Send larger ones to the bot on Telegram.",
    );
  }
  const dataUrl = await readAsDataUrl(file);
  return {
    file: {
      name: file.name,
      mimeType: file.type,
      data: dataUrl.slice(dataUrl.indexOf(",") + 1),
    },
  };
}
