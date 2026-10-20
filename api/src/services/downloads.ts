import { createClient } from "@supabase/supabase-js";
import type { Config } from "../config.js";

export interface DownloadEvent {
  country: string | null;
  device: string;
  uaFamily: string;
  referrer: string | null;
  ipHash: string;
}

/** Persists one download click against the current release. */
export interface DownloadStore {
  record(event: DownloadEvent): Promise<void>;
}

const RELEASE_CACHE_MS = 60_000;

export function createSupabaseDownloads(config: Config): DownloadStore {
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let cached: { id: string | null; at: number } | null = null;

  async function currentReleaseId(): Promise<string | null> {
    if (cached && Date.now() - cached.at < RELEASE_CACHE_MS) return cached.id;
    const { data } = await supabase.from("releases").select("id").eq("is_current", true).maybeSingle();
    cached = { id: data?.id ?? null, at: Date.now() };
    return cached.id;
  }

  return {
    async record(e) {
      const { error } = await supabase.from("download_events").insert({
        release_id: await currentReleaseId(),
        country: e.country,
        device: e.device,
        ua_family: e.uaFamily,
        referrer: e.referrer,
        ip_hash: e.ipHash,
      });
      if (error) throw new Error(error.message);
    },
  };
}
