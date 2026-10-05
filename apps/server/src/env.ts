import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3001),
  // Comma-separated list of origins allowed to call the API (the web app).
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().optional(),
  // Public URL the browser uses for /api/auth (the web app's origin, since
  // the web app proxies /api to this server).
  BETTER_AUTH_URL: z.string().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Comma-separated emails of site admins (can edit player positions etc.).
  ADMIN_EMAILS: z.string().default(""),
});
export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty strings in .env as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const parsed = Env.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
