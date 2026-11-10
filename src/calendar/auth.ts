import { readFile } from "node:fs/promises";
import {
  ExternalAccountClient,
  JWT,
  type BaseExternalAccountClient,
} from "google-auth-library";
import { CALENDAR_EVENTS_SCOPE, getCalendarConfig } from "./config.js";
import { getCurrentVercelOidcToken } from "./request-context.js";

type ServiceAccountJson = {
  type?: string;
  client_email?: string;
  private_key?: string;
  project_id?: string;
};

function parseServiceAccountJson(raw: string): ServiceAccountJson {
  let credentials: ServiceAccountJson;
  try {
    credentials = JSON.parse(raw) as ServiceAccountJson;
  } catch {
    throw new Error("Google service-account credentials are not valid JSON");
  }

  if (
    credentials.type !== "service_account" ||
    !credentials.client_email ||
    !credentials.private_key
  ) {
    throw new Error("Google service-account credentials are incomplete");
  }
  return credentials;
}

export async function createCalendarAuthClient(): Promise<
  JWT | BaseExternalAccountClient
> {
  const config = getCalendarConfig();

  if (config.jsonCredentialsBase64) {
    let decoded: string;
    try {
      decoded = Buffer.from(config.jsonCredentialsBase64, "base64").toString(
        "utf8",
      );
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is invalid");
    }
    const credentials = parseServiceAccountJson(decoded);
    return new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [CALENDAR_EVENTS_SCOPE],
    });
  }

  if (config.credentialsFile) {
    const credentials = parseServiceAccountJson(
      await readFile(config.credentialsFile, "utf8"),
    );
    return new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [CALENDAR_EVENTS_SCOPE],
    });
  }

  const missing = [
    ["GCP_PROJECT_ID", config.gcpProjectId],
    ["GCP_PROJECT_NUMBER", config.gcpProjectNumber],
    ["GCP_SERVICE_ACCOUNT_EMAIL", config.serviceAccountEmail],
    ["GCP_WORKLOAD_IDENTITY_POOL_ID", config.workloadIdentityPoolId],
    [
      "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID",
      config.workloadIdentityProviderId,
    ],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(
      `Missing required Google OIDC environment variable(s): ${missing.join(", ")}`,
    );
  }

  const authClient = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience: `//iam.googleapis.com/projects/${config.gcpProjectNumber}/locations/global/workloadIdentityPools/${config.workloadIdentityPoolId}/providers/${config.workloadIdentityProviderId}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccountEmail}:generateAccessToken`,
    scopes: [CALENDAR_EVENTS_SCOPE],
    subject_token_supplier: {
      getSubjectToken: getCurrentVercelOidcToken,
    },
  });
  if (!authClient)
    throw new Error("Could not initialise Google Workload Identity Federation");
  return authClient;
}
