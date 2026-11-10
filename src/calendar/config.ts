import { optionalEnv, requireEnv } from "../env.js";

// The one Google Calendar this deployment may use, fixed by the deployment's
// GOOGLE_CALENDAR_ID. Incoming messages can never choose another calendar.
// Empty when Google Calendar is not set up; calendar features are then off.
export const FIXED_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID?.trim() ?? "";
// NUSHelper is Singapore-only for now.
export const FIXED_TIME_ZONE = "Asia/Singapore";
export const CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

export type CalendarConfig = {
  calendarId: string;
  timeZone: typeof FIXED_TIME_ZONE;
  jsonCredentialsBase64?: string;
  credentialsFile?: string;
  gcpProjectId?: string;
  gcpProjectNumber?: string;
  serviceAccountEmail?: string;
  workloadIdentityPoolId?: string;
  workloadIdentityProviderId?: string;
};

export function isCalendarConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CALENDAR_ID?.trim());
}

export function getCalendarConfig(): CalendarConfig {
  const calendarId = requireEnv("GOOGLE_CALENDAR_ID");
  // The ID is read once at startup; a different value later would mean the
  // environment changed under a running instance.
  if (calendarId !== FIXED_CALENDAR_ID) {
    throw new Error("GOOGLE_CALENDAR_ID changed after startup");
  }

  const timeZone = optionalEnv("DEFAULT_TIMEZONE") ?? FIXED_TIME_ZONE;
  if (timeZone !== FIXED_TIME_ZONE) {
    throw new Error(`DEFAULT_TIMEZONE must be exactly ${FIXED_TIME_ZONE}`);
  }

  return {
    calendarId: FIXED_CALENDAR_ID,
    timeZone: FIXED_TIME_ZONE,
    jsonCredentialsBase64: optionalEnv("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64"),
    credentialsFile: optionalEnv("GOOGLE_APPLICATION_CREDENTIALS"),
    gcpProjectId: optionalEnv("GCP_PROJECT_ID"),
    gcpProjectNumber: optionalEnv("GCP_PROJECT_NUMBER"),
    serviceAccountEmail: optionalEnv("GCP_SERVICE_ACCOUNT_EMAIL"),
    workloadIdentityPoolId: optionalEnv("GCP_WORKLOAD_IDENTITY_POOL_ID"),
    workloadIdentityProviderId: optionalEnv(
      "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID",
    ),
  };
}
