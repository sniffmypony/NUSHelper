import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { requireEnv } from "../env.js";

const client = postgres(requireEnv("DATABASE_URL"), {
  prepare: false,
  max: 1,
});
export const db = drizzle(client, { schema });
