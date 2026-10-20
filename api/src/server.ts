import "dotenv/config";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSupabaseAuth } from "./services/supabase-auth.js";

const config = loadConfig();
const app = await buildApp(config, createSupabaseAuth(config));

try {
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
