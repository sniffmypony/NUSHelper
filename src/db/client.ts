import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { requireEnv } from "../env.js";

// One connection per instance, and one query on it at a time. postgres.js
// otherwise pipelines up to 100 queries on a connection, and Supabase's
// pooler can hang on pipelined queries. Within a request, queries are
// awaited one by one; but a Vercel instance serves several requests at
// once (the website asks for many things on load), so without this their
// queries were pipelined and the instance could hang until every request
// timed out (seen on 28 Nov 2026). With 0, the next query waits until the
// connection is free.
// (A real postgres.js option that its type definitions leave out.)
const noPipelining = { max_pipeline: 0 } as object;
const client = postgres(requireEnv("DATABASE_URL"), {
  prepare: false,
  max: 1,
  ...noPipelining,
});
export const db = drizzle(client, { schema });
