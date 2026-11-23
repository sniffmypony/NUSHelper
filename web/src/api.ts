// Calls to the bot's website API (/api/web/...). Changes carry the
// X-NUSHelper header the server requires; cookies are same-site only.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  route: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const response = await fetch(`/api/web/${route}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(method === "GET" ? {} : { "X-NUSHelper": "1" }),
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.error ?? `Request failed (${response.status})`,
    );
  }
  return data as T;
}

export interface Me {
  authenticated: boolean;
  fresh: boolean;
  expiresAt: number | null;
}

export type Source = "website" | "vercel" | "unset";

export interface SettingRow {
  key: string;
  label: string;
  help: string;
  value: string | null;
  source: Source;
  vercelValue: string | null;
  updatedAt: string | null;
}

export interface SecretRow {
  key: string;
  label: string;
  help: string;
  source: Source;
  lastFour: string | null;
  updatedAt: string | null;
}

export interface SettingsResponse {
  settings: SettingRow[];
  secrets: SecretRow[];
  calendar: { calendarId: string; serviceAccountEmail: string | null };
}

export interface AuditEntry {
  key: string;
  action: string;
  createdAt: string;
}
