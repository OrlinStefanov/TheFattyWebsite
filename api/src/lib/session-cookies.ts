import type { FastifyReply } from "fastify";
import type { Config } from "../config.js";

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // an admin must sign in again after a week

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
  };
}
