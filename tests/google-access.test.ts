import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startGoogleSignIn,
  forgetGoogleAccessTokens,
} from "../src/google-oauth.js";
import { replaceSettingOverrides } from "../src/setting-overrides.js";
import { decryptSecret } from "../src/settings/crypto.js";
import type { SettingsStore } from "../src/settings/store.js";
import { googleAccess } from "../src/web/google-access.js";

const TOKEN = "123:bot-token";
const NOW = 1_795_800_000;
const SITE = "https://site.example";

function fakeStore() {
  const secrets = new Map<string, string>();
  const values = new Map<string, string>();
  const audit: string[] = [];
  const store = {
    setSecret: vi.fn(async (key: string, ciphertext: string) => {
      secrets.set(key, ciphertext);
    }),
    clearSecret: vi.fn(async (key: string) => {
      secrets.delete(key);
    }),
    setValue: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    clearValue: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    addAudit: vi.fn(async (key: string, action: string) => {
      audit.push(`${key} ${action}`);
    }),
  } as unknown as SettingsStore;
  return { store, secrets, values, audit };
}

function setup(fetchImpl: typeof fetch) {
  const { store, secrets, values, audit } = fakeStore();
  const settingsChanged = vi.fn(async () => {});
  const access = googleAccess({
    store,
    botToken: () => TOKEN,
    ownerId: () => "42",
    siteUrl: () => SITE,
    settingsChanged,
    fetchImpl,
  });
  return { access, secrets, values, audit, settingsChanged };
}

const client = new Map([
  ["GOOGLE_OAUTH_CLIENT_ID", "id.apps.googleusercontent.com"],
  ["GOOGLE_OAUTH_CLIENT_SECRET", "client-secret"],
]);

afterEach(() => {
  replaceSettingOverrides(new Map());
  forgetGoogleAccessTokens();
});

function stateFor(uid = "42") {
  const { url } = startGoogleSignIn({
    clientId: "id",
    siteUrl: SITE,
    botToken: TOKEN,
    uid,
    nowSeconds: NOW,
    nonce: "nonce-1",
  });
  return new URL(url).searchParams.get("state")!;
}

describe("the assistant's Google sign-in on the website", () => {
  it("stores the lasting sign-in encrypted, with the account, after Google's redirect", async () => {
    replaceSettingOverrides(client);
    const idToken = `x.${Buffer.from(JSON.stringify({ email: "me@gmail.com" })).toString("base64url")}.y`;
    const google = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            refresh_token: "rt-secret-9876",
            id_token: idToken,
            scope:
              "openid email https://www.googleapis.com/auth/calendar.events",
          }),
        ),
    );
    const { access, secrets, values, audit, settingsChanged } = setup(google);
    const done = await access.finish(
      { code: "code-1", state: stateFor() },
      "nh_session=x; nh_google=nonce-1",
      NOW + 30,
    );
    expect(done.redirect).toBe("/settings?google=connected");
    expect(done.cookie).toContain("Max-Age=0");
    const stored = secrets.get("GOOGLE_OAUTH_REFRESH_TOKEN")!;
    expect(stored).not.toContain("rt-secret");
    expect(decryptSecret(stored, TOKEN)).toBe("rt-secret-9876");
    expect(values.get("GOOGLE_OAUTH_ACCOUNT")).toBe("me@gmail.com");
    expect(audit).toEqual(["google connected"]);
    expect(settingsChanged).toHaveBeenCalled();
  });

  it("sends the browser back with a reason when it can't connect", async () => {
    replaceSettingOverrides(client);
    const never = vi.fn<typeof fetch>();
    const { access, secrets } = setup(never);
    const back = (
      query: Record<string, string>,
      cookie = "nh_google=nonce-1",
    ) => access.finish(query, cookie, NOW + 30).then((done) => done.redirect);
    expect(await back({ error: "access_denied" })).toBe(
      "/settings?google=denied",
    );
    expect(
      await back({ code: "c", state: stateFor() }, "nh_google=other"),
    ).toBe("/settings?google=expired");
    expect(await back({ code: "c", state: stateFor("someone-else") })).toBe(
      "/settings?google=expired",
    );
    expect(never).not.toHaveBeenCalled();
    const refusing = setup(
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
          }),
      ),
    );
    expect(
      (
        await refusing.access.finish(
          { code: "c", state: stateFor() },
          "nh_google=nonce-1",
          NOW,
        )
      ).redirect,
    ).toBe(
      `/settings?google=error&reason=${encodeURIComponent("Google no longer accepts this sign-in. Connect again.")}`,
    );
    expect(secrets.size).toBe(0);
  });

  it("checks the connection by listing next week's events through MCP", async () => {
    replaceSettingOverrides(
      new Map([
        ...client,
        ["GOOGLE_OAUTH_REFRESH_TOKEN", "rt"],
        ["GOOGLE_CALENDAR_ID", "me@gmail.com"],
      ]),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const server = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("oauth2")) {
        return new Response(
          JSON.stringify({ access_token: "at", expires_in: 3600 }),
        );
      }
      const message = JSON.parse(String(init?.body));
      if (!("id" in message)) return new Response(null, { status: 202 });
      const result =
        message.method === "initialize"
          ? { protocolVersion: "2025-06-18" }
          : {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    events: [{ summary: "Secret meeting" }, {}],
                  }),
                },
              ],
            };
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    });
    const { access } = setup(server);
    expect(await access.check()).toEqual({ count: 2 });
    const call = server.mock.calls
      .filter(([url]) => !String(url).includes("oauth2"))
      .map(([, init]) => JSON.parse(String(init?.body ?? "{}")))
      .find((message) => message.method === "tools/call");
    expect(call.params.arguments).toMatchObject({
      calendarId: "me@gmail.com",
      timeZone: "Asia/Singapore",
      pageSize: 5,
    });
    // Nothing about the events is logged.
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
