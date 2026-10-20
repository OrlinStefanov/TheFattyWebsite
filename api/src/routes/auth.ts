import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { createLoginThrottle } from "../lib/login-throttle.js";
import type { AuthService } from "../plugins/auth.js";

interface Options {
  auth: AuthService;
}

export const authRoutes: FastifyPluginAsyncZod<Options> = async (app, { auth }) => {
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
};
