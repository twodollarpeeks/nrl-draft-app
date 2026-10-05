import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";

/** An error with an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, "not_found", `${what} not found`);
export const forbidden = (message = "You can't do that") => new AppError(403, "forbidden", message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: "invalid_input", message: z.prettifyError(err) });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: "bad_request", message: (err as Error).message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "internal", message: "Something went wrong" });
  });
}
