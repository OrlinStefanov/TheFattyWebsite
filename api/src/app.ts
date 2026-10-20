import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import scalar from "@scalar/fastify-api-reference";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { Config } from "./config.js";
import { authPlugin, type AuthService } from "./plugins/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { healthRoutes } from "./routes/health.js";

export async function buildApp(config: Config, auth: AuthService) {
  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { redact: ["req.headers.authorization"] },
    trustProxy: true, // Render sits behind a proxy; needed for correct client IPs
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const docsEnabled = config.NODE_ENV !== "production";
  if (docsEnabled) {
    await app.register(swagger, {
      openapi: {
        info: { title: "The Fatty API", version: "0.1.0" },
        components: {
          securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
        },
      },
      transform: jsonSchemaTransform,
    });
    await app.register(scalar, { routePrefix: "/docs" });
  }

  // Scalar needs inline scripts, so CSP is off outside production (docs are not served in production).
  await app.register(helmet, { contentSecurityPolicy: !docsEnabled });
  await app.register(cors, {
    origin: config.ALLOWED_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(authPlugin, { auth });

  await app.register(healthRoutes);
  await app.register(adminRoutes, { prefix: "/api/admin" });

  return app;
}
