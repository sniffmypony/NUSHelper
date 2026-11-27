// Shared by the setup scripts: a value from the environment, or else from
// ./.env (which is never committed).
import { existsSync, readFileSync } from "node:fs";

function fromDotEnv(name: string): string | undefined {
  if (!existsSync(".env")) return undefined;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1] === name) return match[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

export function setting(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim() || fromDotEnv(name)?.trim();
    if (value) return value;
  }
  return undefined;
}
