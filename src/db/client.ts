import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { requireEnv } from "../env.js";

// Up to 10 connections per instance, closed again after 20 idle seconds.
// postgres.js gives each query an idle connection, else opens a new one,
// and only pipelines queries onto a busy connection when all of them are
// in use; Supabase's pooler can hang on pipelined queries. A Vercel
// instance serves several requests at once (the website asks for many
// things on load), so with a single connection their queries were
// pipelined and an instance could hang until every request timed out
// (seen from 23 Nov 2026). Within one request, queries are still awaited
// one at a time. prepare: false is needed by the pooler's transaction mode.
// Don't set max_pipeline below its default: postgres.js transactions rely
// on it (#57 set it to 0 and every transaction failed).
export const DB_OPTIONS = {
  prepare: false,
  max: 10,
  idle_timeout: 20,
} as const;

const client = postgres(requireEnv("DATABASE_URL"), DB_OPTIONS);
export const db = drizzle(client, { schema });
