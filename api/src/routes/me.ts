import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
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
            role: z.enum(["user", "admin"]),
          }),
          401: z.object({ error: z.literal("unauthorized") }),
        },
      },
    },
    async (req) => {
      const { id, email, emailVerified, role } = req.user!;
      return { id, email, emailVerified, role };
    },
  );
};
