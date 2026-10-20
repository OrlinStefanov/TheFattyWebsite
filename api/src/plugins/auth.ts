import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { Config } from "../config.js";
import { sessionCookies, type Session } from "../lib/session-cookies.js";

export interface AuthUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  role: "user" | "admin";
}

export interface AuthService {
  /** Resolves an access token to a user (with role from `profiles`), or null if invalid. */
  authenticate(token: string): Promise<AuthUser | null>;
  /** Null means wrong credentials; throws if the auth service itself is unavailable. */
  signIn(email: string, password: string): Promise<Session | null>;
  /** Null means the refresh token is invalid or expired. */
  refresh(refreshToken: string): Promise<Session | null>;
  signOut(accessToken: string): Promise<void>;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
  interface FastifyInstance {
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** CSRF defence for state-changing routes: the Origin header must be this API's own origin. */
    requireSameOrigin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    sessionCookies: ReturnType<typeof sessionCookies>;
  }
}

export const authPlugin = fp<{ auth: AuthService; config: Config }>(async (app, { auth, config }) => {
  const cookies = sessionCookies(config);

  // Parallel requests carrying the same expired access cookie share one refresh. Refresh tokens
  // rotate, so a second parallel refresh with the old token could revoke the whole session.
  const inflight = new Map<string, Promise<Session | null>>();
  function refreshOnce(refreshToken: string) {
    let p = inflight.get(refreshToken);
    if (!p) {
      p = auth.refresh(refreshToken).finally(() => inflight.delete(refreshToken));
      inflight.set(refreshToken, p);
    }
    return p;
  }

  // Bearer tokens are accepted for tools (Scalar, scripts). Browsers use the HttpOnly cookies, and
  // transparently get a new access token when the old one expired but the refresh cookie is valid.
  async function resolveUser(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization;
    if (header) {
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      return token ? auth.authenticate(token) : null;
    }

    const access = req.cookies[cookies.names.access];
    if (access) {
      const user = await auth.authenticate(access);
      if (user) return user;
    }

    const refresh = req.cookies[cookies.names.refresh];
    if (refresh) {
      const session = await refreshOnce(refresh).catch(() => undefined);
      if (session === undefined) return null; // auth service down: keep cookies, ask again later
      if (session === null) {
        cookies.clear(reply);
        return null;
      }
      cookies.set(reply, session);
      return auth.authenticate(session.accessToken);
    }
    return null;
  }

  async function requireUser(req: FastifyRequest, reply: FastifyReply) {
    const user = await resolveUser(req, reply);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
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

  async function requireSameOrigin(req: FastifyRequest, reply: FastifyReply) {
    if (req.headers.origin !== config.PUBLIC_URL) {
      return reply.code(403).send({ error: "forbidden" });
    }
  }

  app.decorate("requireUser", requireUser);
  app.decorate("requireAdmin", requireAdmin);
  app.decorate("requireSameOrigin", requireSameOrigin);
  app.decorate("sessionCookies", cookies);
}, { name: "auth" });
