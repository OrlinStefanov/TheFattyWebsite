import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { downloadAnalyticsSchema, type AnalyticsStore } from "../services/analytics.js";

interface Options {
  analytics: AnalyticsStore;
}

const errors = {
  401: z.object({ error: z.literal("unauthorized") }),
  403: z.object({ error: z.literal("forbidden") }),
};

// Every route registered here requires an admin (role comes from the database, never the request).
export const adminRoutes: FastifyPluginAsyncZod<Options> = async (app, { analytics }) => {
  app.addHook("preHandler", app.requireAdmin);

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
};
