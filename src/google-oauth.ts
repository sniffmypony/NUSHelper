import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// Signing in to the owner's own Google account for the assistant's Calendar
// access (Google's Calendar MCP server accepts only a person's sign-in).
// From February 2027 Google requires AI tools to reach Calendar this way;
// the bot's other Calendar work keeps using its service account.
//
// The website's session cookie is SameSite=Strict, so it isn't sent when
// Google redirects back. The return trip is checked instead by a signed,
// ten-minute `state` (made only for the signed-in owner) and a matching
// SameSite=Lax cookie in the same browser. PKCE's verifier is derived from
// the same nonce, so nothing has to be stored.

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
];
export const GOOGLE_NONCE_COOKIE = "nh_google";
const STATE_SECONDS = 10 * 60;

type Fetch = typeof fetch;

const b64url = (data: Buffer | string) =>
  Buffer.from(data).toString("base64url");

function hmac(botToken: string, purpose: string, text: string): Buffer {
  return createHmac("sha256", botToken).update(`${purpose}:${text}`).digest();
}

function verifierFor(nonce: string, botToken: string): string {
  return b64url(hmac(botToken, "google-pkce", nonce));
}

export function callbackUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/api/web/google/callback`;
}

export function startGoogleSignIn(options: {
  clientId: string;
  siteUrl: string;
  botToken: string;
  uid: string;
  nowSeconds: number;
  nonce?: string;
}): { url: string; cookie: string } {
  const nonce = options.nonce ?? b64url(randomBytes(18));
  const payload = b64url(
    JSON.stringify({
      n: nonce,
      u: options.uid,
      e: options.nowSeconds + STATE_SECONDS,
    }),
  );
  const state = `${payload}.${b64url(hmac(options.botToken, "google-state", payload))}`;
  const challenge = b64url(
    createHash("sha256").update(verifierFor(nonce, options.botToken)).digest(),
  );
  const query = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: callbackUrl(options.siteUrl),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    // A long-lived sign-in, asked for every time so Google sends it again.
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const cookie = [
    `${GOOGLE_NONCE_COOKIE}=${nonce}`,
    "Path=/api/web/google",
    "HttpOnly",
    "Secure",
    // Lax: sent when Google sends the browser back to the site.
    "SameSite=Lax",
    `Max-Age=${STATE_SECONDS}`,
  ].join("; ");
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${query}`,
    cookie,
  };
}

export const clearNonceCookie = `${GOOGLE_NONCE_COOKIE}=; Path=/api/web/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// Who the state was made for, if it is genuine, unexpired and matches this
// browser's cookie.
export function checkState(
  state: string,
  cookieNonce: string | undefined,
  botToken: string,
  nowSeconds: number,
): { uid: string; nonce: string } | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature || !cookieNonce) return null;
  const expected = hmac(botToken, "google-state", payload);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  let data: { n?: unknown; u?: unknown; e?: unknown };
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof data.n !== "string" ||
    typeof data.u !== "string" ||
    typeof data.e !== "number" ||
    data.e < nowSeconds ||
    data.n !== cookieNonce
  ) {
    return null;
  }
  return { uid: data.u, nonce: data.n };
}

async function tokenRequest(
  body: Record<string, string>,
  fetchImpl: Fetch,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Couldn't reach Google.");
  }
  const result = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    // Google's error code only (e.g. invalid_grant), never the request.
    const code = typeof result.error === "string" ? result.error : "";
    throw new Error(
      code === "invalid_grant"
        ? "Google no longer accepts this sign-in. Connect again."
        : code === "invalid_client"
          ? "Google didn't accept the client ID or secret."
          : `Google refused (${code || `HTTP ${response.status}`}).`,
    );
  }
  return result;
}

// The email in an ID token straight from Google's token endpoint (over TLS,
// so its signature needn't be checked here).
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"),
    );
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export async function finishGoogleSignIn(options: {
  code: string;
  nonce: string;
  clientId: string;
  clientSecret: string;
  siteUrl: string;
  botToken: string;
  fetchImpl?: Fetch;
}): Promise<{ refreshToken: string; email: string | null; scopes: string[] }> {
  const result = await tokenRequest(
    {
      grant_type: "authorization_code",
      code: options.code,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: callbackUrl(options.siteUrl),
      code_verifier: verifierFor(options.nonce, options.botToken),
    },
    options.fetchImpl ?? fetch,
  );
  if (typeof result.refresh_token !== "string") {
    throw new Error("Google didn't send a lasting sign-in. Connect again.");
  }
  const scopes =
    typeof result.scope === "string" ? result.scope.split(" ") : [];
  if (!scopes.includes(GOOGLE_SCOPES[2])) {
    throw new Error(
      "Calendar access wasn't granted. Connect again and allow it.",
    );
  }
  return {
    refreshToken: result.refresh_token,
    email: emailFromIdToken(result.id_token),
    scopes,
  };
}

// Short-lived access tokens, reused until a minute before they expire.
const cached = new Map<string, { token: string; until: number }>();

export async function googleAccessToken(options: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  now?: number;
  fetchImpl?: Fetch;
}): Promise<string> {
  const now = options.now ?? Date.now();
  const key = createHash("sha256").update(options.refreshToken).digest("hex");
  const hit = cached.get(key);
  if (hit && hit.until > now) return hit.token;
  const result = await tokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: options.refreshToken,
      client_id: options.clientId,
      client_secret: options.clientSecret,
    },
    options.fetchImpl ?? fetch,
  );
  if (typeof result.access_token !== "string") {
    throw new Error("Google didn't send an access token.");
  }
  const seconds =
    typeof result.expires_in === "number" ? result.expires_in : 3600;
  cached.set(key, {
    token: result.access_token,
    until: now + (seconds - 60) * 1000,
  });
  return result.access_token;
}

export function forgetGoogleAccessTokens(): void {
  cached.clear();
}

export async function revokeGoogleSignIn(
  refreshToken: string,
  fetchImpl: Fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Best effort: the stored sign-in is removed either way.
  }
}
