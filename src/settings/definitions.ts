// The bot settings the website can change. Each one overrides the Vercel
// environment variable(s) named in `env`; clearing it on the website goes
// back to Vercel's value.

export interface SettingDefinition {
  key: string; // the name env.ts reads
  label: string;
  help: string;
  secret: boolean;
  // Vercel variables it replaces, in the order env.ts reads them.
  env: string[];
  // An error message, or null when the value is acceptable.
  validate: (value: string) => string | null;
}

const MODEL_ID = /^[\w.:/@+-]{1,200}$/;

function modelId(value: string): string | null {
  return MODEL_ID.test(value) ? null : "Enter a model id like qwen3.6:35b.";
}

function token(value: string): string | null {
  if (value.length < 8 || value.length > 4096) {
    return "That doesn't look like a key.";
  }
  return /\s/.test(value) ? "Keys can't contain spaces." : null;
}

export const SETTINGS: SettingDefinition[] = [
  {
    key: "LLM_MODEL",
    label: "Main AI model",
    help: "The model the assistant uses on SoCLaaS.",
    secret: false,
    env: ["LLM_MODEL", "SOCLAAS_MODEL"],
    validate: modelId,
  },
  {
    key: "LLM_FALLBACK_MODEL",
    label: "Backup AI model",
    help: "Asked once when the main model's service fails.",
    secret: false,
    env: ["LLM_FALLBACK_MODEL", "SOCLAAS_FALLBACK_MODEL"],
    validate: modelId,
  },
  {
    key: "NUS_MATRICULATION_YEAR",
    label: "Matriculation year",
    help: "The year your Year 1 started, e.g. 2025. Adds Y2 to week labels.",
    secret: false,
    env: ["NUS_MATRICULATION_YEAR"],
    validate: (value) =>
      /^\d{4}$/.test(value) && Number(value) >= 2000 && Number(value) <= 2100
        ? null
        : "Enter a year like 2025.",
  },
  {
    key: "GOOGLE_CALENDAR_ID",
    label: "Calendar",
    help: "The Google Calendar the bot reads and adds events to.",
    secret: false,
    env: ["GOOGLE_CALENDAR_ID"],
    validate: (value) =>
      value.length <= 254 && /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value)
        ? null
        : "Enter a calendar id like you@gmail.com or …@group.calendar.google.com.",
  },
  {
    key: "LLM_API_KEY",
    label: "SoCLaaS API key",
    help: "Used for every AI request.",
    secret: true,
    env: ["LLM_API_KEY", "SOCLAAS_API_KEY"],
    validate: token,
  },
  {
    key: "CANVAS_API_TOKEN",
    label: "Canvas access token",
    help: "Canvas > Account > Settings > New access token.",
    secret: true,
    env: ["CANVAS_API_TOKEN"],
    validate: token,
  },
];

export function settingDefinition(key: string): SettingDefinition | undefined {
  return SETTINGS.find((setting) => setting.key === key);
}

// Internal value, not shown as a setting: raising it signs out every
// website session.
export const SESSION_VERSION_KEY = "WEB_SESSION_VERSION";
