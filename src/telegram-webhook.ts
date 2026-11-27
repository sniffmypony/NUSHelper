// Pointing Telegram at the bot: setWebhook with the secret the webhook
// handler checks, and getWebhookInfo to see whether it is connected. Used by
// `pnpm setup:webhook` and by Settings → Telegram on the website. No local
// imports, so the setup scripts can run this file with Node directly; the
// caller passes the secret (webhookSecretFor in webhook-secret.ts).

// Only the update types the bot handles.
export const ALLOWED_UPDATES = ["message", "edited_message", "callback_query"];

export interface WebhookStatus {
  // Where the webhook should point (this site), when known.
  expectedUrl: string | null;
  // Where Telegram sends updates now ("" when no webhook is set).
  url: string;
  connected: boolean;
  pendingUpdates: number;
  lastError: string | null;
  // ISO time of the last delivery error, if any.
  lastErrorAt: string | null;
}

type Fetch = typeof fetch;

export function webhookUrlFor(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/api/webhook`;
}

async function callTelegram<T>(
  token: string,
  method: string,
  body: unknown,
  fetchImpl: Fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    // The request address holds the token, so no details from here.
    throw new Error("Couldn't reach Telegram.");
  }
  const result = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
  };
  if (!result.ok) {
    // Telegram's own words, never the token (it isn't in the reply).
    throw new Error(result.description ?? `HTTP ${response.status}`);
  }
  return result.result as T;
}

export async function registerWebhook(
  token: string,
  url: string,
  secret: string,
  fetchImpl: Fetch = fetch,
): Promise<void> {
  if (!/^https:\/\/[^/]+\/api\/webhook$/.test(url)) {
    throw new Error("The webhook must be https://<your site>/api/webhook.");
  }
  await callTelegram(
    token,
    "setWebhook",
    {
      url,
      secret_token: secret,
      allowed_updates: ALLOWED_UPDATES,
    },
    fetchImpl,
  );
}

export async function webhookStatus(
  token: string,
  expectedUrl: string | null,
  fetchImpl: Fetch = fetch,
): Promise<WebhookStatus> {
  const info = await callTelegram<{
    url?: string;
    pending_update_count?: number;
    last_error_date?: number;
    last_error_message?: string;
  }>(token, "getWebhookInfo", {}, fetchImpl);
  const url = info.url ?? "";
  return {
    expectedUrl,
    url,
    connected: Boolean(url) && (!expectedUrl || url === expectedUrl),
    pendingUpdates: info.pending_update_count ?? 0,
    lastError: info.last_error_message ?? null,
    lastErrorAt: info.last_error_date
      ? new Date(info.last_error_date * 1000).toISOString()
      : null,
  };
}
