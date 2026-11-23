// Settings saved on the website take precedence over the Vercel environment
// variable of the same name. refreshSettings (src/settings/runtime.ts) fills
// this at the start of each request; until then it is empty and everything
// falls back to the environment. It has no imports so env.ts can use it.
let overrides = new Map<string, string>();

export function settingOverride(name: string): string | undefined {
  return overrides.get(name);
}

export function replaceSettingOverrides(values: Map<string, string>): void {
  overrides = new Map(values);
}
