import "dotenv/config";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSupabaseAnalytics } from "./services/analytics.js";
import { createSupabaseCommunity } from "./services/community.js";
import { createSupabaseDownloads } from "./services/downloads.js";
import { createSupabaseAuth } from "./services/supabase-auth.js";

const config = loadConfig();
const app = await buildApp(config, {
  auth: createSupabaseAuth(config),
  downloads: createSupabaseDownloads(config),
  analytics: createSupabaseAnalytics(config),
  community: createSupabaseCommunity(config),
});

try {
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
