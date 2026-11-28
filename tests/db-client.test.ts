import { describe, expect, it, vi } from "vitest";

// See src/db/client.ts: enough connections that concurrent requests on one
// instance don't pipeline queries onto one, closed when idle, and
// pipelining left at its default (transactions depend on it).
describe("the database client", () => {
  it("has room for concurrent requests and leaves pipelining alone", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/db");
    const { db } = await import("../src/db/client.js");
    const options = (
      db as unknown as { $client: { options: Record<string, unknown> } }
    ).$client.options;
    expect(options.max).toBeGreaterThanOrEqual(8);
    expect(options.idle_timeout).toBe(20);
    expect(options.prepare).toBe(false);
    expect(options.max_pipeline).toBe(100);
    vi.unstubAllEnvs();
  });
});
