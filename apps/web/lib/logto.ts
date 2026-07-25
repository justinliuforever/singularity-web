import "server-only";

// VERCEL_PROJECT_PRODUCTION_URL is the stable alias that follows domain binds; VERCEL_URL
// is per-deployment and must stay below it.
function resolveBaseUrl(): string {
  if (process.env.LOGTO_BASE_URL) return process.env.LOGTO_BASE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export const logtoConfig = {
  endpoint: process.env.LOGTO_ENDPOINT!,
  appId: process.env.LOGTO_APP_ID!,
  appSecret: process.env.LOGTO_APP_SECRET!,
  baseUrl: resolveBaseUrl(),
  cookieSecret: process.env.LOGTO_COOKIE_SECRET!,
  cookieSecure: process.env.NODE_ENV === "production",
  scopes: ["email", "profile"],
};
