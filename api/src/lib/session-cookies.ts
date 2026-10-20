import type { FastifyReply } from "fastify";
import type { Config } from "../config.js";

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // an admin must sign in again after a week

const PKCE_MAX_AGE = 10 * 60; // the sign-in round trip must finish within 10 minutes

/**
 * Session cookies: HttpOnly (scripts can never read them), SameSite=Strict, and in production
 * Secure with the __Host- prefix (forces Secure, Path=/ and no Domain, so a sibling subdomain
 * cannot overwrite them). The prefix is skipped outside production because plain-http
 * localhost cannot set Secure cookies in every browser.
 */
export function sessionCookies(config: Config) {
  const prod = config.NODE_ENV === "production";
  const prefix = prod ? "__Host-" : "";
  const names = { access: `${prefix}fatty_at`, refresh: `${prefix}fatty_rt` };
  const base = { httpOnly: true, secure: prod, sameSite: "strict" as const, path: "/" };

  return {
    names,
    set(reply: FastifyReply, s: Session) {
      reply.setCookie(names.access, s.accessToken, { ...base, maxAge: Math.max(1, Math.min(s.expiresIn, 3600)) });
      reply.setCookie(names.refresh, s.refreshToken, { ...base, maxAge: REFRESH_COOKIE_MAX_AGE });
    },
    clear(reply: FastifyReply) {
      reply.clearCookie(names.access, base);
      reply.clearCookie(names.refresh, base);
    },
    /**
     * The one-time PKCE secret for an OAuth sign-in. It binds the callback to the browser that
     * started the flow (login CSRF protection). Unlike the session cookies it must be SameSite=Lax:
     * the callback is a cross-site top-level navigation (Supabase -> this API), and Strict cookies
     * are not sent on those. It lives for ten minutes and is deleted as soon as it is used.
     */
    pkce: {
      name: `${prefix}fatty_pkce`,
      set(reply: FastifyReply, verifier: string) {
        reply.setCookie(`${prefix}fatty_pkce`, verifier, { ...base, sameSite: "lax" as const, maxAge: PKCE_MAX_AGE });
      },
      clear(reply: FastifyReply) {
        reply.clearCookie(`${prefix}fatty_pkce`, { ...base, sameSite: "lax" as const });
      },
    },
  };
}
