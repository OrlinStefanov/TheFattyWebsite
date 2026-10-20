import { createHash, randomBytes } from "node:crypto";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../config.js";
import { createLoginThrottle } from "../lib/login-throttle.js";
import { OAUTH_PROVIDERS, type AuthService } from "../plugins/auth.js";

interface Options {
  auth: AuthService;
  config: Config;
}

const LOGIN_ERROR_PAGE = "/community/?error=login";

export const authRoutes: FastifyPluginAsyncZod<Options> = async (app, { auth, config }) => {
  const cookies = app.sessionCookies;
  const throttle = createLoginThrottle();

  app.post(
    "/login",
    {
      preHandler: app.requireSameOrigin,
      // Tight limit per address: this endpoint is the one an attacker would brute-force.
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        tags: ["account"],
        summary: "Sign in. Sets HttpOnly session cookies; the tokens are never returned in the body",
        body: z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) }),
        response: {
          204: z.null().describe("Signed in"),
          401: z.object({ error: z.literal("invalid_credentials") }),
          403: z.object({ error: z.literal("forbidden") }),
          // Either our per-account lock ("too_many_attempts") or the per-IP rate limiter's own message.
          429: z.object({ error: z.string() }),
          503: z.object({ error: z.literal("unavailable") }),
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      if (throttle.blocked(email)) return reply.code(429).send({ error: "too_many_attempts" });
      let session;
      try {
        session = await auth.signIn(email, password);
      } catch (err) {
        req.log.error({ err }, "sign-in failed: auth service unavailable");
        return reply.code(503).send({ error: "unavailable" });
      }
      // One answer for every kind of failure, so it cannot be used to discover which emails exist.
      if (!session) {
        throttle.fail(email);
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      throttle.succeed(email);
      cookies.set(reply, session);
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/logout",
    {
      preHandler: app.requireSameOrigin,
      schema: {
        tags: ["account"],
        summary: "Sign out: revokes the session and clears the cookies",
        response: { 204: z.null().describe("Signed out"), 403: z.object({ error: z.literal("forbidden") }) },
      },
    },
    async (req, reply) => {
      // The access cookie lives ~1h; if it has expired, trade the refresh token for a fresh access
      // token first so the session is still revoked server-side rather than just forgotten here.
      let access = req.cookies[cookies.names.access];
      const refresh = req.cookies[cookies.names.refresh];
      if (!access && refresh) access = (await auth.refresh(refresh).catch(() => null))?.accessToken;
      if (access) await auth.signOut(access);
      cookies.clear(reply);
      return reply.code(204).send(null);
    },
  );

  // ---- OAuth (Google, Discord) with PKCE ---------------------------------------------------
  // Start: a random verifier goes into a short-lived cookie; only its hash is sent onwards. The
  // callback must present the same verifier, so a sign-in started by someone else cannot be
  // completed in this browser (login CSRF).
  app.get(
    "/oauth/:provider",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags: ["account"],
        summary: "Start signing in with Google or Discord (redirects)",
        params: z.object({ provider: z.enum(OAUTH_PROVIDERS) }),
      },
    },
    async (req, reply) => {
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      cookies.pkce.set(reply, verifier);
      return reply.redirect(auth.oauthUrl(req.params.provider, `${config.PUBLIC_URL}/api/auth/callback`, challenge));
    },
  );

  app.get(
    "/callback",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags: ["account"],
        summary: "OAuth return point: exchanges the code for a session, sets cookies, redirects",
        querystring: z.object({
          code: z.string().max(2048).optional(),
          error: z.string().max(200).optional(),
        }),
      },
    },
    async (req, reply) => {
      const verifier = req.cookies[cookies.pkce.name];
      cookies.pkce.clear(reply); // one use only, whatever happens next
      const { code, error } = req.query;
      // The redirect targets below are fixed local paths: nothing from the request is echoed back.
      if (error || !code || !verifier) return reply.redirect(LOGIN_ERROR_PAGE);

      const session = await auth.exchangeCode(code, verifier).catch((err) => {
        req.log.error({ err }, "oauth code exchange failed");
        return null;
      });
      if (!session) return reply.redirect(LOGIN_ERROR_PAGE);

      cookies.set(reply, session);
      return reply.redirect("/community/");
    },
  );
};
