export class CanvasAuthError extends Error {
  constructor() {
    super("Canvas rejected the API token");
    this.name = "CanvasAuthError";
  }
}

export class CanvasRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CanvasRequestError";
  }
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  due_at: string | null;
  html_url?: string;
  submission?: { workflow_state?: string; submitted_at?: string | null };
}

export interface CanvasFile {
  id: number;
  display_name: string;
  filename: string;
  size: number;
  folder_id: number;
  url?: string;
  locked_for_user?: boolean;
  updated_at?: string;
  "content-type"?: string;
}

export interface CanvasFolder {
  id: number;
  name: string;
  full_name: string;
}

const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 20_000;

export function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
    if (match) return match[1];
  }
  return null;
}

export class CanvasClient {
  private readonly origin: string;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.origin = new URL(baseUrl).origin;
  }

  private buildUrl(
    path: string,
    params: Record<string, string | string[]> = {},
  ): string {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        url.searchParams.append(key, item);
      }
    }
    return url.toString();
  }

  private async request(url: string): Promise<Response> {
    // Never send the token anywhere other than the configured Canvas host,
    // even if a pagination link points elsewhere.
    if (new URL(url).origin !== this.origin) {
      throw new CanvasRequestError("Canvas returned an unexpected link");
    }

    const response = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 401) {
      const body = await response.text().catch(() => "");
      // Canvas also answers 401 for resources the user cannot see (e.g. a
      // hidden Files tab); only a token problem carries these markers.
      if (
        response.headers.has("www-authenticate") ||
        /invalid access token|expired/i.test(body)
      ) {
        throw new CanvasAuthError();
      }
      throw new CanvasRequestError("Canvas denied access to this item", 401);
    }
    if (!response.ok) {
      throw new CanvasRequestError(
        `Canvas request failed: HTTP ${response.status}`,
        response.status,
      );
    }
    return response;
  }

  async getAll<T>(
    path: string,
    params: Record<string, string | string[]> = {},
  ): Promise<T[]> {
    const items: T[] = [];
    let url: string | null = this.buildUrl(path, {
      per_page: "100",
      ...params,
    });
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const response = await this.request(url);
      items.push(...((await response.json()) as T[]));
      url = nextPageUrl(response.headers.get("link"));
    }
    return items;
  }

  async getOne<T>(path: string): Promise<T> {
    const response = await this.request(this.buildUrl(path));
    return (await response.json()) as T;
  }

  listActiveCourses(): Promise<CanvasCourse[]> {
    return this.getAll<CanvasCourse>("/api/v1/courses", {
      enrollment_state: "active",
    });
  }

  // "future" covers every assignment due after now; the caller trims the window.
  listFutureAssignments(courseId: number): Promise<CanvasAssignment[]> {
    return this.getAll<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments`,
      { bucket: "future", "include[]": "submission", order_by: "due_at" },
    );
  }

  searchFiles(courseId: number, searchTerm: string): Promise<CanvasFile[]> {
    return this.getAll<CanvasFile>(`/api/v1/courses/${courseId}/files`, {
      search_term: searchTerm,
    });
  }

  listFolders(courseId: number): Promise<CanvasFolder[]> {
    return this.getAll<CanvasFolder>(`/api/v1/courses/${courseId}/folders`);
  }

  listFolderFiles(folderId: number): Promise<CanvasFile[]> {
    return this.getAll<CanvasFile>(`/api/v1/folders/${folderId}/files`);
  }

  getFile(fileId: number): Promise<CanvasFile> {
    return this.getOne<CanvasFile>(`/api/v1/files/${fileId}`);
  }

  // Follows Canvas's own redirects (with the token) until it hands off to its
  // file store, and returns that short-lived signed URL. It needs no token, so
  // Telegram can fetch it directly. Returns null if Canvas serves the file itself.
  async resolveSignedUrl(file: CanvasFile): Promise<string | null> {
    if (!file.url) return null;
    let url = new URL(file.url, this.baseUrl);
    for (let hop = 0; hop < 5; hop++) {
      if (url.origin !== this.origin) return url.toString();
      const response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.token}` },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      await response.body?.cancel();
      if (response.status === 401) throw new CanvasAuthError();
      const location = response.headers.get("location");
      if (!isRedirect(response.status) || !location) return null;
      url = new URL(location, url);
    }
    return null;
  }

  async downloadFile(file: CanvasFile): Promise<Buffer> {
    if (!file.url) throw new CanvasRequestError("File has no download URL");

    // The first hop is on Canvas and needs the token. Canvas then redirects
    // to its file store with a signed URL, which must not receive the token.
    let response = await this.fetchImpl(file.url, {
      headers:
        new URL(file.url).origin === this.origin
          ? { Authorization: `Bearer ${this.token}` }
          : {},
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    for (let hop = 0; hop < 5 && isRedirect(response.status); hop++) {
      const location = response.headers.get("location");
      if (!location) break;
      response = await this.fetchImpl(new URL(location, file.url), {
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
    }
    if (response.status === 401) throw new CanvasAuthError();
    if (!response.ok) {
      throw new CanvasRequestError(
        `Canvas download failed: HTTP ${response.status}`,
        response.status,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}
