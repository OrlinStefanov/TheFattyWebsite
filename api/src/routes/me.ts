import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { CommunityStore } from "../services/community.js";

export const meRoutes: FastifyPluginAsyncZod<{ community: CommunityStore }> = async (app, { community }) => {
  app.get(
    "/me",
    {
      preHandler: app.requireUser,
      schema: {
        tags: ["account"],
        summary: "Who am I? Returns the signed-in user and their role",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.object({
            id: z.string(),
            email: z.string().nullable(),
            emailVerified: z.boolean(),
            username: z.string().nullable(),
            role: z.enum(["user", "admin"]),
          }),
          401: z.object({ error: z.literal("unauthorized") }),
        },
      },
    },
    async (req) => {
      const { id, email, emailVerified, username, role } = req.user!;
      return { id, email, emailVerified, username, role };
    },
  );

  app.delete(
    "/me",
    {
      preHandler: [app.requireSameOrigin, app.requireUser],
      config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
      schema: {
        tags: ["account"],
        summary: "Delete your account, profile and review permanently",
        security: [{ bearerAuth: [] }],
        response: {
          204: z.null().describe("Deleted"),
          401: z.object({ error: z.literal("unauthorized") }),
          403: z.object({ error: z.enum(["forbidden", "admin_cannot_delete"]) }),
        },
      },
    },
    async (req, reply) => {
      // An admin deleting their own account would lock everyone out of moderation by accident.
      if (req.user!.role === "admin") return reply.code(403).send({ error: "admin_cannot_delete" });
      await community.deleteAccount(req.user!.id);
      app.sessionCookies.clear(reply);
      return reply.code(204).send(null);
    },
  );
};
