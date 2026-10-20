import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

export interface AuthUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  role: "user" | "admin";
}

/** Resolves a bearer token to a user (with role from `profiles`), or null if invalid. */
export interface AuthService {
  authenticate(token: string): Promise<AuthUser | null>;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
  interface FastifyInstance {
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp<{ auth: AuthService }>(async (app, { auth }) => {
  async function requireUser(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const user = token ? await auth.authenticate(token) : null;
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    req.user = user;
  }

  async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
    await requireUser(req, reply);
    if (reply.sent) return;
    // Role comes from the database via the auth service, never from the request.
    if (req.user?.role !== "admin") {
      return reply.code(403).send({ error: "forbidden" });
    }
  }

  app.decorate("requireUser", requireUser);
  app.decorate("requireAdmin", requireAdmin);
});
