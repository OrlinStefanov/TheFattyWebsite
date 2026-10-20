import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { reviewBodySchema } from "../lib/review-text.js";
import type { CommunityStore } from "../services/community.js";

const publicReview = z.object({
  rating: z.number(),
  body: z.string(),
  username: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const ownReview = z.object({
  rating: z.number(),
  body: z.string(),
  status: z.enum(["visible", "hidden"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const summary = z.object({
  count: z.number(),
  average: z.number(),
  distribution: z.object({ "1": z.number(), "2": z.number(), "3": z.number(), "4": z.number(), "5": z.number() }),
});
const err = (code: string) => z.object({ error: z.literal(code) });

export const reviewRoutes: FastifyPluginAsyncZod<{ community: CommunityStore }> = async (app, { community }) => {
  // ---- public (no cookies, so the cross-origin site may read them) ----------------------------
  app.get(
    "/reviews",
    {
      schema: {
        tags: ["community"],
        summary: "Visible reviews, newest first",
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(50).default(20),
          offset: z.coerce.number().int().min(0).max(10_000).default(0),
        }),
        response: { 200: z.object({ items: z.array(publicReview), total: z.number() }) },
      },
    },
    async (req) => {
      // No browser caching (the global no-store default applies): there is no CDN to take the load, and
      // someone who has just posted must see their review on the next reload.
      const { items, total } = await community.listReviews({ ...req.query, status: "visible" });
      // Only public fields: no ids, no moderation status.
      return {
        items: items.map(({ rating, body, username, createdAt, updatedAt }) => ({ rating, body, username, createdAt, updatedAt })),
        total,
      };
    },
  );

  app.get(
    "/reviews/summary",
    { schema: { tags: ["community"], summary: "Average rating, count and star distribution", response: { 200: summary } } },
    async () => community.summary(),
  );

  // ---- your own review ---------------------------------------------------------------------
  app.get(
    "/reviews/me",
    {
      preHandler: app.requireUser,
      schema: {
        tags: ["community"],
        summary: "Your review, if you wrote one",
        security: [{ bearerAuth: [] }],
        response: { 200: z.object({ review: ownReview.nullable() }), 401: err("unauthorized") },
      },
    },
    async (req) => {
      const r = await community.getOwnReview(req.user!.id);
      return { review: r && { rating: r.rating, body: r.body, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt } };
    },
  );

  app.put(
    "/reviews/me",
    {
      preHandler: [app.requireSameOrigin, app.requireUser],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["community"],
        summary: "Write or edit your review (one per account)",
        security: [{ bearerAuth: [] }],
        body: z.object({ rating: z.number().int().min(1).max(5), body: reviewBodySchema }),
        response: {
          200: z.object({ review: ownReview }),
          401: err("unauthorized"),
          403: z.object({ error: z.enum(["forbidden", "email_not_verified", "username_required"]) }),
        },
      },
    },
    async (req, reply) => {
      const user = req.user!;
      if (!user.emailVerified) return reply.code(403).send({ error: "email_not_verified" });
      if (!user.username) return reply.code(403).send({ error: "username_required" });
      const r = await community.upsertReview(user.id, req.body.rating, req.body.body);
      return { review: { rating: r.rating, body: r.body, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt } };
    },
  );

  app.delete(
    "/reviews/me",
    {
      preHandler: [app.requireSameOrigin, app.requireUser],
      schema: {
        tags: ["community"],
        summary: "Delete your review",
        security: [{ bearerAuth: [] }],
        response: {
          204: z.null().describe("Deleted"),
          401: err("unauthorized"),
          403: err("forbidden"),
          // A moderator hid it: it stays (hidden) so it cannot simply be reposted as a visible review.
          409: err("hidden_by_moderator"),
        },
      },
    },
    async (req, reply) => {
      const result = await community.deleteOwnReview(req.user!.id);
      if (result === "hidden") return reply.code(409).send({ error: "hidden_by_moderator" });
      return reply.code(204).send(null);
    },
  );
};
