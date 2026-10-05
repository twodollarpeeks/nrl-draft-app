import type { PrismaClient } from "@nrl/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Env } from "./env.ts";

export function createAuth(env: Env, db: PrismaClient) {
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is not set");
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, prompt: "select_account" as const } }
      : undefined;

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.WEB_ORIGIN.split(",").map((o) => o.trim()),
    database: prismaAdapter(db, { provider: "postgresql" }),
    socialProviders: google,
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh daily while in use
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

/** Resolves the signed-in user for a request, or null. */
export type GetUser = (req: FastifyRequest) => Promise<SessionUser | null>;

export function headersFrom(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  return headers;
}

export function sessionUserGetter(auth: Auth): GetUser {
  return async (req) => {
    const session = await auth.api.getSession({ headers: headersFrom(req) });
    if (!session) return null;
    const u = session.user;
    return { id: u.id, name: u.name, email: u.email, image: u.image ?? null };
  };
}

/** Mount Better Auth's routes at /api/auth/* (sign-in, callback, session...). */
export function registerAuthRoutes(app: FastifyInstance, auth: Auth) {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(req, reply) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const body =
        req.method === "GET" || req.body === undefined
          ? undefined
          : typeof req.body === "string"
            ? req.body
            : JSON.stringify(req.body);
      const response = await auth.handler(new Request(url, { method: req.method, headers: headersFrom(req), body }));

      reply.status(response.status);
      for (const [key, value] of response.headers) {
        if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
      }
      // Each cookie must be its own header; Headers.forEach would join them.
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
