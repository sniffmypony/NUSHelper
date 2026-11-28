import { describe, expect, it, vi } from "vitest";

// Supabase's pooler can hang on pipelined queries, and one Vercel instance
// serves several requests at once: the client must send one query at a
// time on its one connection (see src/db/client.ts).
describe("the database client", () => {
  it("uses one connection and never pipelines queries", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:5432/db");
    const { db } = await import("../src/db/client.js");
    const options = (
      db as unknown as { $client: { options: Record<string, unknown> } }
    ).$client.options;
    expect(options.max).toBe(1);
    expect(options.max_pipeline).toBe(0);
    expect(options.prepare).toBe(false);
    vi.unstubAllEnvs();
  });
});
