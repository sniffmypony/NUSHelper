import { strFromU8, unzipSync } from "fflate";

// Turns a file into something the model can read: its text, plus images of
// PDF pages so formulas, tables and diagrams survive. The model API accepts
// images but not PDFs or Office files.

export const MAX_READ_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 40_000;
export const MAX_PAGE_IMAGES = 6;
const RENDER_SCALE = 1.5;

export interface DocumentContent {
  name: string;
  text: string;
  // data: URLs, in page order.
  images: Array<{ label: string; url: string }>;
  pageCount?: number;
  note?: string;
}

type Kind = "pdf" | "pptx" | "docx" | "text" | "image" | "unsupported";

const TEXT_EXTENSIONS =
  /\.(txt|md|csv|tsv|json|sql|py|java|c|h|cpp|hpp|js|ts|tsx|jsx|html|css|xml|yml|yaml|r|m|go|rs|kt|swift|sh|tex)$/i;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function documentKind(name: string, mimeType = ""): Kind {
  const lower = name.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".pptx")) return "pptx";
  if (lower.endsWith(".docx")) return "docx";
  if (mimeType.startsWith("text/") || TEXT_EXTENSIONS.test(lower))
    return "text";
  if (
    IMAGE_TYPES[lower.split(".").pop() ?? ""] ||
    mimeType.startsWith("image/")
  )
    return "image";
  return "unsupported";
}

// "2-4,7" -> [2, 3, 4, 7], clamped to the document and capped.
export function parsePageList(
  spec: string | undefined,
  pageCount: number,
): number[] {
  if (!spec?.trim()) {
    return Array.from(
      { length: Math.min(pageCount, MAX_PAGE_IMAGES) },
      (_, i) => i + 1,
    );
  }
  const pages = new Set<number>();
  for (const part of spec.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    for (
      let page = start;
      page <= end && pages.size < MAX_PAGE_IMAGES;
      page++
    ) {
      if (page >= 1 && page <= pageCount) pages.add(page);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

function clip(text: string): string {
  return text.length > MAX_TEXT_CHARS
    ? `${text.slice(0, MAX_TEXT_CHARS)}\n[… text cut off; ask for specific pages]`
    : text;
}

function decodeXmlText(xml: string): string {
  return xml
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Text runs of an Office XML part, one paragraph per line.
function officeText(xml: string, run: "a:t" | "w:t", paragraph: "a:p" | "w:p") {
  return xml
    .split(new RegExp(`</${paragraph}>`))
    .map((part) =>
      [
        ...part.matchAll(
          new RegExp(`<${run}(?:\\s[^>]*)?>([^<]*)</${run}>`, "g"),
        ),
      ]
        .map((m) => decodeXmlText(m[1]))
        .join(""),
    )
    .filter((line) => line.trim())
    .join("\n");
}

function readPptx(bytes: Buffer): DocumentContent["text"] {
  const files = unzipSync(new Uint8Array(bytes), {
    filter: (file) => /^ppt\/slides\/slide\d+\.xml$/.test(file.name),
  });
  return Object.entries(files)
    .map(
      ([name, data]) =>
        [Number(/slide(\d+)\.xml$/.exec(name)![1]), data] as const,
    )
    .sort((a, b) => a[0] - b[0])
    .map(
      ([n, data]) =>
        `--- slide ${n} ---\n${officeText(strFromU8(data), "a:t", "a:p")}`,
    )
    .join("\n\n");
}

function readDocx(bytes: Buffer): string {
  const files = unzipSync(new Uint8Array(bytes), {
    filter: (file) => file.name === "word/document.xml",
  });
  const xml = files["word/document.xml"];
  return xml ? officeText(strFromU8(xml), "w:t", "w:p") : "";
}

async function readPdf(
  name: string,
  bytes: Buffer,
  pagesSpec: string | undefined,
): Promise<DocumentContent> {
  const { getDocumentProxy, extractText, renderPageAsImage } =
    await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pageText = text
    .map((page, i) => `--- page ${i + 1} ---\n${page.trim()}`)
    .join("\n\n");

  const images: DocumentContent["images"] = [];
  let note: string | undefined;
  for (const page of parsePageList(pagesSpec, totalPages)) {
    try {
      const url = await renderPageAsImage(pdf, page, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: RENDER_SCALE,
        toDataURL: true,
      });
      images.push({ label: `${name} page ${page}`, url });
    } catch (error) {
      // Text still works without the renderer; say so instead of failing.
      console.error(
        `PDF page rendering failed (${error instanceof Error ? error.name : typeof error}); using text only`,
      );
      note = "Page images could not be rendered; only the text was read.";
      break;
    }
  }
  const hasText = text.some((page) => page.trim().length > 20);
  if (!hasText && images.length === 0) {
    note =
      "This PDF has no readable text (probably scanned). Ask the user for photos of the pages.";
  }
  return { name, text: clip(pageText), images, pageCount: totalPages, note };
}

export async function readDocument(
  name: string,
  bytes: Buffer,
  options: { mimeType?: string; pages?: string } = {},
): Promise<DocumentContent> {
  if (bytes.length > MAX_READ_BYTES) {
    return {
      name,
      text: "",
      images: [],
      note: "File is too large to read (over 25 MB).",
    };
  }
  switch (documentKind(name, options.mimeType)) {
    case "pdf":
      return readPdf(name, bytes, options.pages);
    case "pptx":
      return { name, text: clip(readPptx(bytes)), images: [] };
    case "docx":
      return { name, text: clip(readDocx(bytes)), images: [] };
    case "text":
      return { name, text: clip(bytes.toString("utf8")), images: [] };
    case "image": {
      const ext = name.toLowerCase().split(".").pop() ?? "";
      const type = IMAGE_TYPES[ext] ?? options.mimeType ?? "image/png";
      return {
        name,
        text: "",
        images: [
          {
            label: name,
            url: `data:${type};base64,${bytes.toString("base64")}`,
          },
        ],
      };
    }
    default:
      return {
        name,
        text: "",
        images: [],
        note: "This file type can't be read (supported: PDF, PowerPoint, Word, text, code and images).",
      };
  }
}

// What the model sees as the tool result or attachment text.
export function describeDocument(content: DocumentContent): string {
  const header = [
    `File: ${content.name}`,
    content.pageCount ? `Pages: ${content.pageCount}` : "",
    content.images.length
      ? `Page images attached: ${content.images.map((i) => i.label.replace(`${content.name} `, "")).join(", ")}`
      : "",
    content.note ? `Note: ${content.note}` : "",
  ].filter(Boolean);
  return `${header.join("\n")}${content.text ? `\n\n${content.text}` : ""}`;
}
