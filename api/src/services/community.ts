import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Config } from "../config.js";

export type ReviewStatus = "visible" | "hidden";

export interface ReviewItem {
  id: string;
  rating: number;
  body: string;
  username: string | null;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSummary {
  count: number;
  average: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}

export interface OwnReview {
  id: string;
  rating: number;
  body: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityStore {
  listReviews(opts: { limit: number; offset: number; status: ReviewStatus | "all" }): Promise<{ items: ReviewItem[]; total: number }>;
  summary(): Promise<ReviewSummary>;
  getOwnReview(userId: string): Promise<OwnReview | null>;
  /** Creates the user's one review, or edits it. An edit never changes a moderator's hide/unhide. */
  upsertReview(userId: string, rating: number, body: string): Promise<OwnReview>;
  /** A review a moderator has hidden is kept (so it cannot be reposted as visible): returns "hidden". */
  deleteOwnReview(userId: string): Promise<"deleted" | "none" | "hidden">;
  setUsername(userId: string, username: string): Promise<"ok" | "taken">;
  setReviewStatus(id: string, status: ReviewStatus): Promise<boolean>;
  deleteReview(id: string): Promise<boolean>;
  /** Removes the auth user; the profile and review go with it (foreign keys cascade). */
  deleteAccount(userId: string): Promise<void>;
}

const summarySchema = z.object({
  count: z.number(),
  average: z.number(),
  distribution: z.object({ "1": z.number(), "2": z.number(), "3": z.number(), "4": z.number(), "5": z.number() }),
});

const reviewRow = z.object({
  id: z.string(),
  rating: z.number(),
  body: z.string(),
  status: z.enum(["visible", "hidden"]),
  created_at: z.string(),
  updated_at: z.string(),
});
const listRow = reviewRow.extend({
  profiles: z.union([z.object({ username: z.string().nullable() }), z.array(z.object({ username: z.string().nullable() }))]).nullable(),
});

const toOwn = (r: z.infer<typeof reviewRow>): OwnReview => ({
  id: r.id, rating: r.rating, body: r.body, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
});

export function createSupabaseCommunity(config: Config): CommunityStore {
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const columns = "id, rating, body, status, created_at, updated_at";

  return {
    async listReviews({ limit, offset, status }) {
      let q = supabase
        .from("reviews")
        .select(`${columns}, profiles(username)`, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (status !== "all") q = q.eq("status", status);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      const items = z.array(listRow).parse(data).map((r) => {
        const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
        return { ...toOwn(r), username: profile?.username ?? null };
      });
      return { items, total: count ?? items.length };
    },

    async summary() {
      const { data, error } = await supabase.rpc("review_summary");
      if (error) throw new Error(error.message);
      return summarySchema.parse(data);
    },

    async getOwnReview(userId) {
      const { data, error } = await supabase.from("reviews").select(columns).eq("user_id", userId).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? toOwn(reviewRow.parse(data)) : null;
    },

    async upsertReview(userId, rating, body) {
      // On conflict only the listed columns change, so a hidden review stays hidden after an edit.
      const { data, error } = await supabase
        .from("reviews")
        .upsert({ user_id: userId, rating, body, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
        .select(columns)
        .single();
      if (error) throw new Error(error.message);
      return toOwn(reviewRow.parse(data));
    },

    async deleteOwnReview(userId) {
      const { data: existing, error: readError } = await supabase.from("reviews").select("status").eq("user_id", userId).maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!existing) return "none";
      if (existing.status === "hidden") return "hidden";
      const { error } = await supabase.from("reviews").delete().eq("user_id", userId);
      if (error) throw new Error(error.message);
      return "deleted";
    },

    async setUsername(userId, username) {
      const { data, error } = await supabase.from("profiles").update({ username }).eq("id", userId).select("id");
      if (error?.code === "23505") return "taken"; // unique index on lower(username)
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("no profile row for this user");
      return "ok";
    },

    async setReviewStatus(id, status) {
      const { data, error } = await supabase.from("reviews").update({ status }).eq("id", id).select("id");
      if (error) throw new Error(error.message);
      return (data?.length ?? 0) > 0;
    },

    async deleteReview(id) {
      const { data, error } = await supabase.from("reviews").delete().eq("id", id).select("id");
      if (error) throw new Error(error.message);
      return (data?.length ?? 0) > 0;
    },

    async deleteAccount(userId) {
      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
    },
  };
}
