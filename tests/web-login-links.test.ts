import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client.js", () => ({ db: {} }));

import {
  LINK_TTL_MS,
  consumeLoginToken,
  createLoginToken,
  hashToken,
  loginLink,
  websiteUrl,
  type LoginLinkStore,
} from "../src/web/login-links.js";
import { verifySession, isFresh } from "../src/web/session.js";
import { handleWebRequest, type WebDependencies } from "../src/web/router.js";

class MemoryLinks implements LoginLinkStore {
  rows = new Map<string, { expiresAt: Date; usedAt: Date | null }>();
  async add(tokenHash: string, expiresAt: Date) {
    this.rows.set(tokenHash, { expiresAt, usedAt: null });
  }
  async consume(tokenHash: string, now: Date) {
    const row = this.rows.get(tokenHash);
    if (!row || row.usedAt || row.expiresAt <= now) return false;
    row.usedAt = now;
    return true;
  }
}

const NOW = new Date("2026-11-23T15:00:00Z");

describe("one-time sign-in links", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("work once, store only a hash, and expire after 20 minutes", async () => {
    const store = new MemoryLinks();
    const token = await createLoginToken(store, NOW);
    expect(token).toMatch(/^[\w-]{43}$/);
    expect([...store.rows.keys()]).toEqual([hashToken(token)]);
    expect(store.rows.has(token)).toBe(false);

    expect(await consumeLoginToken(store, token, NOW)).toBe(true);
    expect(await consumeLoginToken(store, token, NOW)).toBe(false);

    expect(LINK_TTL_MS).toBe(20 * 60_000);
    const later = await createLoginToken(store, NOW);
    expect(
      await consumeLoginToken(
        store,
        later,
        new Date(NOW.getTime() + 19 * 60_000),
      ),
    ).toBe(true);

    const late = await createLoginToken(store, NOW);
    expect(
      await consumeLoginToken(
        store,
        late,
        new Date(NOW.getTime() + LINK_TTL_MS),
      ),
    ).toBe(false);
    expect(await consumeLoginToken(store, "not a token", NOW)).toBe(false);
  });

  it("put the token after # so previews and scanners can't use it", () => {
    expect(loginLink("https://nushelper-example.vercel.app", "abc")).toBe(
      "https://nushelper-example.vercel.app/login#token=abc",
    );
  });

  it("use WEB_URL, else the Vercel production domain", () => {
    vi.stubEnv("WEB_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "nushelper-example.vercel.app");
    expect(websiteUrl()).toBe("https://nushelper-example.vercel.app");
    vi.stubEnv("WEB_URL", "https://planner.example.com/");
    expect(websiteUrl()).toBe("https://planner.example.com");
    vi.stubEnv("WEB_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(websiteUrl()).toBeNull();
  });

  it("sign in with a fresh session through the API", async () => {
    const consume = vi.fn(
      async (token: string) => token === "good-token-1234567890ab",
    );
    const deps = {
      botToken: () => "123:token",
      ownerId: () => "42",
      nowSeconds: () => 1_795_400_000,
      store: { values: async () => new Map() },
      consumeLoginToken: consume,
    } as unknown as WebDependencies;
    const call = (token: string) =>
      handleWebRequest(
        {
          method: "POST",
          route: "auth/link",
          csrfHeader: "1",
          body: { token },
        },
        deps,
      );

    const ok = await call("good-token-1234567890ab");
    expect(ok.status).toBe(200);
    const cookie = ok.setCookie!.split(";")[0].split("=").slice(1).join("=");
    const session = verifySession(cookie, "123:token", 1_795_400_000, 0)!;
    expect(session.uid).toBe("42");
    expect(isFresh(session, 1_795_400_000)).toBe(true);

    const bad = await call("used-token-1234567890ab");
    expect(bad.status).toBe(401);
    expect(bad.setCookie).toBeUndefined();
  });
});
