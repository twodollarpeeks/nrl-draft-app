import type { GetUser, HasHeaders, SessionUser } from "./auth.ts";
import { AppError, forbidden } from "./errors.ts";

export interface Guards {
  /** The signed-in user, or a 401. */
  requireUser(req: HasHeaders): Promise<SessionUser>;
  /** The signed-in site admin, or a 401/403. */
  requireAdmin(req: HasHeaders): Promise<SessionUser>;
}

export function parseAdminEmails(list: string | undefined): Set<string> {
  return new Set(
    (list ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function createGuards(getUser: GetUser, adminEmails: ReadonlySet<string>): Guards {
  async function requireUser(req: HasHeaders): Promise<SessionUser> {
    const user = await getUser(req);
    if (!user) throw new AppError(401, "unauthenticated", "Please sign in");
    return { ...user, isAdmin: adminEmails.has(user.email.toLowerCase()) };
  }
  return {
    requireUser,
    async requireAdmin(req) {
      const user = await requireUser(req);
      if (!user.isAdmin) throw forbidden("Admins only");
      return user;
    },
  };
}
