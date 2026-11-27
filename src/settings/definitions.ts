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

function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && value.length <= 300 && !url.username
      ? null
      : "Enter an https:// address.";
  } catch {
    return "Enter an https:// address.";
  }
}

// A Google service-account key, base64 of the JSON file Google gives you
// (the website encodes the uploaded file).
export function serviceAccountKey(value: string): string | null {
  if (value.length > 20_000 || !/^[A-Za-z0-9+/=]+$/.test(value)) {
    return "Upload the JSON key file Google gave you.";
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    return parsed?.type === "service_account" &&
      typeof parsed.client_email === "string" &&
      typeof parsed.private_key === "string"
      ? null
      : "That isn't a service-account key (it needs client_email and private_key).";
  } catch {
    return "Upload the JSON key file Google gave you.";
  }
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
    help: "The model the assistant uses, from your AI provider.",
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
    key: "LLM_BASE_URL",
    label: "AI provider address",
    help: "Any OpenAI-compatible API whose models support tool calling, e.g. https://api.openai.com/v1, or SoCLaaS for NUS students.",
    secret: false,
    env: ["LLM_BASE_URL", "SOCLAAS_BASE_URL"],
    validate: httpsUrl,
  },
  {
    key: "CANVAS_BASE_URL",
    label: "Canvas address",
    help: "Your school's Canvas, e.g. https://canvas.nus.edu.sg.",
    secret: false,
    env: ["CANVAS_BASE_URL"],
    validate: httpsUrl,
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
    label: "AI provider API key",
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
  {
    key: "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64",
    label: "Service-account key",
    help: "The JSON key of a Google Cloud service account with the Calendar API enabled.",
    secret: true,
    env: ["GOOGLE_SERVICE_ACCOUNT_JSON_BASE64"],
    validate: serviceAccountKey,
  },
];

export function settingDefinition(key: string): SettingDefinition | undefined {
  return SETTINGS.find((setting) => setting.key === key);
}

// Internal value, not shown as a setting: raising it signs out every
// website session.
export const SESSION_VERSION_KEY = "WEB_SESSION_VERSION";
