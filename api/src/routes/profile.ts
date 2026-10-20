import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { usernameSchema } from "../lib/usernames.js";
import type { CommunityStore } from "../services/community.js";

export const profileRoutes: FastifyPluginAsyncZod<{ community: CommunityStore }> = async (app, { community }) => {
  app.patch(
    "/profile",
    {
      preHandler: [app.requireSameOrigin, app.requireUser],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["community"],
        summary: "Set or change your public username",
        security: [{ bearerAuth: [] }],
        body: z.object({ username: usernameSchema }),
        response: {
          200: z.object({ username: z.string() }),
          401: z.object({ error: z.literal("unauthorized") }),
          403: z.object({ error: z.enum(["forbidden", "email_not_verified"]) }),
          409: z.object({ error: z.literal("username_taken") }),
        },
      },
    },
    async (req, reply) => {
      // Unverified accounts cannot hold names (stops cheap name squatting).
      if (!req.user!.emailVerified) return reply.code(403).send({ error: "email_not_verified" });
      const result = await community.setUsername(req.user!.id, req.body.username);
      if (result === "taken") return reply.code(409).send({ error: "username_taken" });
      return { username: req.body.username };
    },
  );
};
