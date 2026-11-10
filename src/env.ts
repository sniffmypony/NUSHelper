export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function requireAnyEnv(
  preferredName: string,
  ...fallbackNames: string[]
): string {
  const value = optionalEnv(preferredName, ...fallbackNames);
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${[preferredName, ...fallbackNames].join(" or ")}`,
    );
  }
  return value;
}

export function telegramBotToken(): string {
  return requireAnyEnv("TELEGRAM_BOT_TOKEN", "BOT_TOKEN");
}

export function telegramOwnerId(): string {
  return requireAnyEnv("TELEGRAM_OWNER_ID", "OWNER_TELEGRAM_ID");
}

// Read lazily so the rest of the bot keeps working when the assistant is not
// configured. Any OpenAI-compatible chat-completions API with tool calling
// works; the SOCLAAS_* names are accepted for existing NUS SoCLaaS setups.
export function llmConfig(): {
  apiKey: string;
  baseURL: string;
  model: string;
} {
  return {
    apiKey: requireAnyEnv("LLM_API_KEY", "SOCLAAS_API_KEY"),
    baseURL: requireAnyEnv("LLM_BASE_URL", "SOCLAAS_BASE_URL"),
    model: requireAnyEnv("LLM_MODEL", "SOCLAAS_MODEL"),
  };
}

// Canvas is optional: without both values its tools are left out.
export function isCanvasConfigured(): boolean {
  return Boolean(
    optionalEnv("CANVAS_API_TOKEN") && optionalEnv("CANVAS_BASE_URL"),
  );
}

export function canvasConfig(): { token: string; baseUrl: string } {
  return {
    token: requireEnv("CANVAS_API_TOKEN"),
    baseUrl: requireEnv("CANVAS_BASE_URL").replace(/\/+$/, ""),
  };
}
