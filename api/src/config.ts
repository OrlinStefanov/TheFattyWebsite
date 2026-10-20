import { z } from "zod";

const httpUrl = z.string().url().regex(/^https?:\/\//, "must start with http:// or https://");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  // Exact origin of the static site, e.g. https://orlinstefanov.github.io (no path, no trailing slash)
  ALLOWED_ORIGIN: httpUrl,
  SUPABASE_URL: httpUrl,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return parsed.data;
}
