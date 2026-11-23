import { replaceSettingOverrides } from "../setting-overrides.js";
import { decryptSecret } from "./crypto.js";
import { settingsStore, type SettingsStore } from "./store.js";

// Loads the website's settings into the override map env.ts reads. Called
// at the start of every request and scheduled job; reads the database at
// most every 30 seconds per instance, so a change takes effect within about
// half a minute. If the database can't be read, the last loaded values (or
// Vercel's) stay in use.

const MAX_AGE_MS = 30_000;
let loadedAt = 0;

function botToken(): string | undefined {
  // Straight from Vercel: the token itself is never a website setting.
  return (
    process.env.TELEGRAM_BOT_TOKEN?.trim() || process.env.BOT_TOKEN?.trim()
  );
}

export async function refreshSettings(
  store: SettingsStore = settingsStore,
  now = Date.now(),
): Promise<void> {
  if (now - loadedAt < MAX_AGE_MS) return;
  try {
    // One after the other: the bot has a single database connection, and
    // Supabase's transaction pooler can hang on queries pipelined on one.
    const values = await store.values();
    const secrets = await store.secrets();
    const overrides = new Map<string, string>();
    for (const [key, { value }] of values) overrides.set(key, value);
    const token = botToken();
    for (const [key, secret] of secrets) {
      const plain = token ? decryptSecret(secret.ciphertext, token) : null;
      if (plain) overrides.set(key, plain);
    }
    replaceSettingOverrides(overrides);
    loadedAt = now;
  } catch (error) {
    const type = error instanceof Error ? error.name : typeof error;
    console.error(`Loading website settings failed (${type})`);
  }
}

// After a change on the website, this instance applies it immediately.
export function forgetLoadedSettings(): void {
  loadedAt = 0;
}

export { botToken as settingsBotToken };
