import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { downloadAnalyticsSchema, type AnalyticsStore } from "../services/analytics.js";
import type { CommunityStore } from "../services/community.js";

interface Options {
  analytics: AnalyticsStore;
  community: CommunityStore;
}

const errors = {
  401: z.object({ error: z.literal("unauthorized") }),
  403: z.object({ error: z.literal("forbidden") }),
};
const notFound = z.object({ error: z.literal("not_found") });

// Every route registered here requires an admin (role comes from the database, never the request).
export const adminRoutes: FastifyPluginAsyncZod<Options> = async (app, { analytics, community }) => {
  app.addHook("preHandler", app.requireAdmin);
  // Cookie sessions make state-changing requests forgeable cross-site, so those must come from
  // this API's own pages (Origin check). Reads are safe.
  app.addHook("preHandler", async (req, reply) => {
    if (req.method !== "GET" && req.method !== "HEAD") await app.requireSameOrigin(req, reply);
  });

  app.get(
    "/ping",
    {
      schema: {
        tags: ["admin"],
        summary: "Check that your token is valid and has the admin role",
        security: [{ bearerAuth: [] }],
        response: { 200: z.object({ ok: z.literal(true), userId: z.string() }), ...errors },
      },
    },
    async (req) => ({ ok: true as const, userId: req.user!.id }),
  );

  app.get(
    "/analytics/downloads",
    {
      schema: {
        tags: ["admin"],
        summary: "Download statistics for the last N days (UTC)",
        security: [{ bearerAuth: [] }],
        querystring: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
        response: { 200: downloadAnalyticsSchema, ...errors },
      },
    },
    async (req) => analytics.downloads(req.query.days),
  );

  // ---- review moderation -------------------------------------------------------------------
  app.get(
    "/reviews",
    {
      schema: {
        tags: ["admin"],
        summary: "All reviews including hidden ones, newest first",
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          status: z.enum(["all", "visible", "hidden"]).default("all"),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          offset: z.coerce.number().int().min(0).max(10_000).default(0),
        }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                rating: z.number(),
                body: z.string(),
                username: z.string().nullable(),
                status: z.enum(["visible", "hidden"]),
                createdAt: z.string(),
                updatedAt: z.string(),
              }),
            ),
            total: z.number(),
          }),
          ...errors,
        },
      },
    },
    async (req) => community.listReviews(req.query),
  );

  app.patch(
    "/reviews/:id",
    {
      schema: {
        tags: ["admin"],
        summary: "Hide or unhide a review",
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ status: z.enum(["visible", "hidden"]) }),
        response: { 204: z.null().describe("Updated"), 404: notFound, ...errors },
      },
    },
    async (req, reply) => {
      const found = await community.setReviewStatus(req.params.id, req.body.status);
      if (!found) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send(null);
    },
  );

  app.delete(
    "/reviews/:id",
    {
      schema: {
        tags: ["admin"],
        summary: "Delete a review permanently",
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null().describe("Deleted"), 404: notFound, ...errors },
      },
    },
    async (req, reply) => {
      const found = await community.deleteReview(req.params.id);
      if (!found) return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send(null);
    },
  );
};
