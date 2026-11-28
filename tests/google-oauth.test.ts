import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkState,
  finishGoogleSignIn,
  forgetGoogleAccessTokens,
  googleAccessToken,
  startGoogleSignIn,
} from "../src/google-oauth.js";

const TOKEN = "123:bot-token";
const NOW = 1_795_800_000;
const SITE = "https://site.example";

function start(nonce = "nonce-abc") {
  return startGoogleSignIn({
    clientId: "id.apps.googleusercontent.com",
    siteUrl: SITE,
    botToken: TOKEN,
    uid: "42",
    nowSeconds: NOW,
    nonce,
  });
}

const reply = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status }),
  );

afterEach(() => forgetGoogleAccessTokens());

describe("signing in to Google for the assistant", () => {
  it("asks for a lasting Calendar sign-in, with PKCE", () => {
    const { url, cookie } = start();
    const params = new URL(url).searchParams;
    expect(params.get("redirect_uri")).toBe(`${SITE}/api/web/google/callback`);
    expect(params.get("scope")).toBe(
      "openid email https://www.googleapis.com/auth/calendar.events",
    );
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(cookie).toContain("nh_google=nonce-abc");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/web/google");
  });

  it("accepts only its own unexpired state, back in the same browser", () => {
    const state = new URL(start().url).searchParams.get("state")!;
    expect(checkState(state, "nonce-abc", TOKEN, NOW + 60)).toEqual({
      uid: "42",
      nonce: "nonce-abc",
    });
    expect(checkState(state, "other-browser", TOKEN, NOW)).toBeNull();
    expect(checkState(state, undefined, TOKEN, NOW)).toBeNull();
    expect(checkState(state, "nonce-abc", TOKEN, NOW + 11 * 60)).toBeNull();
    expect(checkState(state, "nonce-abc", "other-bot", NOW)).toBeNull();
    const [payload] = state.split(".");
    expect(checkState(`${payload}.forged`, "nonce-abc", TOKEN, NOW)).toBeNull();
  });

  it("trades the code for a lasting sign-in, with the matching verifier", async () => {
    const challenge = new URL(start().url).searchParams.get("code_challenge");
    const idToken = `x.${Buffer.from(JSON.stringify({ email: "me@gmail.com" })).toString("base64url")}.y`;
    const google = reply({
      access_token: "at",
      refresh_token: "rt-1234",
      id_token: idToken,
      scope: "openid https://www.googleapis.com/auth/calendar.events email",
    });
    const result = await finishGoogleSignIn({
      code: "code-1",
      nonce: "nonce-abc",
      clientId: "id",
      clientSecret: "secret",
      siteUrl: SITE,
      botToken: TOKEN,
      fetchImpl: google,
    });
    expect(result).toMatchObject({
      refreshToken: "rt-1234",
      email: "me@gmail.com",
    });
    const body = new URLSearchParams(String(google.mock.calls[0][1]?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe(`${SITE}/api/web/google/callback`);
    expect(
      createHash("sha256")
        .update(body.get("code_verifier")!)
        .digest("base64url"),
    ).toBe(challenge);
  });

  it("refuses a sign-in without Calendar access, and explains Google's refusals", async () => {
    const base = {
      code: "c",
      nonce: "n",
      clientId: "id",
      clientSecret: "secret",
      siteUrl: SITE,
      botToken: TOKEN,
    };
    await expect(
      finishGoogleSignIn({
        ...base,
        fetchImpl: reply({ refresh_token: "rt", scope: "openid email" }),
      }),
    ).rejects.toThrow("Calendar access wasn't granted");
    await expect(
      finishGoogleSignIn({
        ...base,
        fetchImpl: reply({ error: "invalid_client" }, 401),
      }),
    ).rejects.toThrow("Google didn't accept the client ID or secret.");
  });

  it("reuses an access token until a minute before it expires", async () => {
    const google = reply({ access_token: "at-1", expires_in: 3600 });
    const options = {
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "rt",
      fetchImpl: google,
    };
    expect(await googleAccessToken({ ...options, now: 0 })).toBe("at-1");
    expect(await googleAccessToken({ ...options, now: 3_500_000 })).toBe(
      "at-1",
    );
    await googleAccessToken({ ...options, now: 3_550_000 });
    expect(google).toHaveBeenCalledTimes(2);
  });
});
