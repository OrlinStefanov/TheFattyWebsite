import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Config } from "../config.js";

const bucket = z.object({ label: z.string(), downloads: z.number() });

export const downloadAnalyticsSchema = z.object({
  days: z.number(),
  total: z.number(),
  // Sum of each day's distinct hashed IPs (the hash rotates daily, so not unique across days).
  visitor_days: z.number(),
  by_day: z.array(z.object({ day: z.string(), downloads: z.number(), visitors: z.number() })),
  by_version: z.array(bucket),
  by_country: z.array(bucket),
  by_device: z.array(bucket),
  by_browser: z.array(bucket),
  by_referrer: z.array(bucket),
  recent: z.array(
    z.object({
      ts: z.string(),
      country: z.string().nullable(),
      device: z.string().nullable(),
      browser: z.string().nullable(),
      referrer: z.string().nullable(),
      version: z.string(),
    }),
  ),
});

export type DownloadAnalytics = z.infer<typeof downloadAnalyticsSchema>;

export interface AnalyticsStore {
  downloads(days: number): Promise<DownloadAnalytics>;
}

export function createSupabaseAnalytics(config: Config): AnalyticsStore {
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async downloads(days) {
      const { data, error } = await supabase.rpc("download_analytics", { p_days: days });
      if (error) throw new Error(error.message);
      return downloadAnalyticsSchema.parse(data);
    },
  };
}
