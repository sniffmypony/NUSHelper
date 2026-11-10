import { AsyncLocalStorage } from "node:async_hooks";

const oidcTokenStorage = new AsyncLocalStorage<string | undefined>();

function normaliseHeader(
  value: string | string[] | undefined,
): string | undefined {
  const token = Array.isArray(value) ? value[0] : value;
  return token?.trim() || undefined;
}

export async function withVercelOidcToken<T>(
  header: string | string[] | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  const token =
    normaliseHeader(header) ?? process.env.VERCEL_OIDC_TOKEN?.trim();
  return oidcTokenStorage.run(token, callback);
}

export async function getCurrentVercelOidcToken(): Promise<string> {
  const token =
    oidcTokenStorage.getStore() ?? process.env.VERCEL_OIDC_TOKEN?.trim();
  if (!token) {
    throw new Error("Vercel OIDC token is unavailable for this request");
  }
  return token;
}
