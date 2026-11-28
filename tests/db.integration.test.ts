import { describe, expect, it } from "vitest";

// Against a real Postgres (CI's migrations job sets TEST_DATABASE_URL; it
// is skipped elsewhere). Guards the database client's settings: #57 broke
// every transaction while all the unit tests passed.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("the database client against Postgres", () => {
  async function connect() {
    process.env.DATABASE_URL = url;
    const { db } = await import("../src/db/client.js");
    const { sql } = await import("drizzle-orm");
    return { db, sql };
  }

  it("commits and rolls back transactions", async () => {
    const { db, sql } = await connect();
    await db.execute(sql`create table if not exists client_check (n int)`);
    await db.transaction(async (tx) => {
      await tx.execute(sql`insert into client_check values (1)`);
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into client_check values (2)`);
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");
    const rows = Array.from(
      await db.execute(sql`select n from client_check order by n`),
    ) as Array<{ n: number }>;
    expect(rows.map((row) => row.n)).toEqual([1]);
    await db.execute(sql`drop table client_check`);
  });

  it("runs a transaction while another query is still running", async () => {
    const { db, sql } = await connect();
    const slow = db.execute(sql`select pg_sleep(0.3)`);
    const result = await db.transaction(async (tx) =>
      Array.from(await tx.execute(sql`select 7 as n`)),
    );
    await slow;
    expect(result).toEqual([{ n: 7 }]);
  });

  it("runs concurrent queries on separate connections, not one after another", async () => {
    const { db, sql } = await connect();
    const started = Date.now();
    await Promise.all(
      Array.from({ length: 6 }, () => db.execute(sql`select pg_sleep(0.4)`)),
    );
    // Six 0.4 s queries on one connection would take 2.4 s.
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
