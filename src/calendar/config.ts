import { optionalEnv, requireEnv } from "../env.js";

// The one Google Calendar the bot uses: GOOGLE_CALENDAR_ID, which the owner
// can change on the website (Settings) or in Vercel. Incoming messages can
// never choose another calendar. Empty when Google Calendar is not set up;
// calendar features are then off.
export function calendarId(): string {
  return optionalEnv("GOOGLE_CALENDAR_ID") ?? "";
}
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
  return Boolean(calendarId());
}

export function getCalendarConfig(): CalendarConfig {
  const id = requireEnv("GOOGLE_CALENDAR_ID");

  const timeZone = optionalEnv("DEFAULT_TIMEZONE") ?? FIXED_TIME_ZONE;
  if (timeZone !== FIXED_TIME_ZONE) {
    throw new Error(`DEFAULT_TIMEZONE must be exactly ${FIXED_TIME_ZONE}`);
  }

  return {
    calendarId: id,
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
