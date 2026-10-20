import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

// Every route registered here requires an admin. Analytics endpoints will be added in a later phase.
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("preHandler", app.requireAdmin);

  app.get(
    "/ping",
    {
      schema: {
        tags: ["admin"],
        summary: "Check that your token is valid and has the admin role",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({ ok: z.literal(true), userId: z.string() }),
          401: z.object({ error: z.literal("unauthorized") }),
          403: z.object({ error: z.literal("forbidden") }),
        },
      },
    },
    async (req) => ({ ok: true as const, userId: req.user!.id }),
  );
};
