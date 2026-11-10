import {
  CanvasAuthError,
  type CanvasClient,
  type CanvasFile,
} from "../canvas/client.js";
import { formatBytes } from "./format.js";
import type { TelegramFileCache } from "./store.js";

export const TELEGRAM_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
// Telegram fetches a document from a URL itself only for PDF and ZIP files
// up to 20 MB; anything else has to be uploaded.
const TELEGRAM_URL_LIMIT_BYTES = 20 * 1024 * 1024;
export const MAX_FILES_PER_SEND = 10;

export type DocumentSource =
  | { kind: "cached"; fileId: string }
  | { kind: "url"; url: string }
  | { kind: "bytes"; bytes: Buffer };

export interface OutgoingDocument {
  filename: string;
  source: DocumentSource;
}

export interface FileDelivery {
  setUploading(): void;
  // Sends one document, or 2-10 as a single album. Returns Telegram's file id
  // for each document, in order.
  sendDocuments(
    documents: OutgoingDocument[],
  ): Promise<Array<string | undefined>>;
}

function canTelegramFetch(file: CanvasFile): boolean {
  if (file.size > TELEGRAM_URL_LIMIT_BYTES) return false;
  const type = file["content-type"] ?? "";
  return (
    /^application\/(pdf|zip|x-zip-compressed)$/.test(type) ||
    /\.(pdf|zip)$/i.test(file.filename ?? file.display_name ?? "")
  );
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// Sends Canvas files with the cheapest source available for each: a cached
// Telegram id (instant), a signed URL Telegram fetches itself (PDF/ZIP), or
// the downloaded bytes. Returns the text the assistant shows the user.
export async function sendCanvasFiles(
  fileIds: number[],
  deps: {
    canvas: CanvasClient;
    delivery: FileDelivery;
    cache?: TelegramFileCache;
  },
): Promise<string> {
  const { canvas, delivery, cache } = deps;
  const notes: string[] = [];

  const lookups = await Promise.allSettled(
    fileIds.map((id) => canvas.getFile(id)),
  );
  const files: CanvasFile[] = [];
  lookups.forEach((lookup, index) => {
    if (lookup.status === "fulfilled") {
      files.push(lookup.value);
      return;
    }
    if (lookup.reason instanceof CanvasAuthError) throw lookup.reason;
    notes.push(`File ${fileIds[index]} could not be opened on Canvas.`);
  });

  const sendable = files.filter((file) => {
    if (file.locked_for_user) {
      notes.push(`${file.display_name} is locked on Canvas.`);
      return false;
    }
    if (file.size > TELEGRAM_UPLOAD_LIMIT_BYTES) {
      notes.push(
        `${file.display_name} is ${formatBytes(file.size)}, too big for Telegram (50 MB limit). Download it from Canvas.`,
      );
      return false;
    }
    return true;
  });
  if (sendable.length === 0) return `Not sent. ${notes.join(" ")}`.trim();

  const started = Date.now();
  const cached = await (
    cache?.get(sendable.map((file) => file.id)) ?? Promise.resolve(new Map())
  ).catch((error: unknown) => {
    console.error(`File cache read failed (${errorType(error)})`);
    return new Map();
  });

  delivery.setUploading();
  const download = async (file: CanvasFile): Promise<DocumentSource> => ({
    kind: "bytes",
    bytes: await canvas.downloadFile(file),
  });
  const sources = await Promise.all(
    sendable.map(async (file): Promise<DocumentSource> => {
      const hit = cached.get(file.id);
      if (hit && hit.canvasUpdatedAt === (file.updated_at ?? "")) {
        return { kind: "cached", fileId: hit.telegramFileId };
      }
      if (canTelegramFetch(file)) {
        try {
          const url = await canvas.resolveSignedUrl(file);
          if (url) return { kind: "url", url };
        } catch (error) {
          if (error instanceof CanvasAuthError) throw error;
        }
      }
      return download(file);
    }),
  );
  const prepared = Date.now();

  const documents = sendable.map((file, index) => ({
    filename: file.display_name || file.filename,
    source: sources[index],
  }));
  let telegramIds: Array<string | undefined>;
  try {
    telegramIds = await delivery.sendDocuments(documents);
  } catch (error) {
    // Telegram could not fetch a URL or no longer knows a cached id: fall
    // back to uploading the bytes for those documents.
    if (documents.every((document) => document.source.kind === "bytes")) {
      throw error;
    }
    console.error(`File send retrying with uploads (${errorType(error)})`);
    for (const [index, document] of documents.entries()) {
      if (document.source.kind !== "bytes") {
        document.source = await download(sendable[index]);
      }
    }
    telegramIds = await delivery.sendDocuments(documents);
  }
  const sent = Date.now();

  const count = (kind: DocumentSource["kind"]) =>
    documents.filter((document) => document.source.kind === kind).length;
  console.log(
    `File send timing: files=${documents.length} cached=${count("cached")} url=${count("url")} upload=${count("bytes")} prepare=${prepared - started}ms send=${sent - prepared}ms`,
  );

  const toCache = sendable.flatMap((file, index) => {
    const telegramFileId = telegramIds[index];
    return telegramFileId && documents[index].source.kind !== "cached"
      ? [
          {
            canvasFileId: file.id,
            canvasUpdatedAt: file.updated_at ?? "",
            telegramFileId,
          },
        ]
      : [];
  });
  if (cache && toCache.length > 0) {
    await cache.set(toCache).catch((error: unknown) => {
      console.error(`File cache write failed (${errorType(error)})`);
    });
  }

  const names = sendable.map(
    (file) => `${file.display_name} (${formatBytes(file.size)})`,
  );
  return [`Sent ${names.join(", ")}.`, ...notes].join(" ");
}
