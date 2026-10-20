import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import scalar from "@scalar/fastify-api-reference";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import { authPlugin, type AuthService } from "./plugins/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { downloadRoutes } from "./routes/download.js";
import { healthRoutes } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import type { AnalyticsStore } from "./services/analytics.js";
import type { DownloadStore } from "./services/downloads.js";

export interface Services {
  auth: AuthService;
  downloads: DownloadStore;
  analytics: AnalyticsStore;
}

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

export async function buildApp(config: Config, { auth, downloads, analytics }: Services) {
  const prod = config.NODE_ENV === "production";

  const app = Fastify({
    logger: config.NODE_ENV === "test" ? false : { redact: ["req.headers.authorization", "req.headers.cookie"] },
    // Trust only the proxy hops we actually have. `true` would believe a client-supplied
    // X-Forwarded-For and let anyone forge their IP (rate limits, IP hash).
    trustProxy: (_addr: string, hop: number) => hop < config.TRUST_PROXY_HOPS,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const docsEnabled = !prod;
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
  }

  // Strict CSP for everything the API serves (the admin pages). No inline scripts or styles.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: prod ? [] : null, // plain-http localhost must keep working
      },
    },
    referrerPolicy: { policy: "no-referrer" },
    // The download beacon and /health are called from the GitHub Pages origin.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  // CORS is only for the public, cookie-less endpoints. Credentials are deliberately not allowed,
  // so a page on another site can never make the browser send the session cookies.
  await app.register(cors, {
    origin: config.ALLOWED_ORIGIN,
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization", "Content-Type"],
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(authPlugin, { auth, config });

  // Never cache API answers (they can hold personal data); always revalidate admin pages.
  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    else if (req.url.startsWith("/admin")) reply.header("Cache-Control", "no-cache");
  });

  if (docsEnabled) {
    // Scalar needs inline scripts, so it alone gets no CSP, and only outside production.
    await app.register(async (docs) => {
      docs.addHook("onSend", async (_req, reply) => {
        reply.removeHeader("content-security-policy");
      });
      await docs.register(scalar, { routePrefix: "/docs" });
    });
  }

  await app.register(fastifyStatic, { root: PUBLIC_DIR, index: "index.html", cacheControl: false });

  await app.register(healthRoutes);
  await app.register(downloadRoutes, { prefix: "/api", config, downloads });
  await app.register(authRoutes, { prefix: "/api/auth", auth });
  await app.register(meRoutes, { prefix: "/api" });
  await app.register(adminRoutes, { prefix: "/api/admin", analytics });

  return app;
}
