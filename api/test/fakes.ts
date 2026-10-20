import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { AuthService, AuthUser } from "../src/plugins/auth.js";
import type { CommunityStore, OwnReview, ReviewItem, ReviewStatus } from "../src/services/community.js";

export const env = {
  NODE_ENV: "test",
  ALLOWED_ORIGIN: "https://example.github.io",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-key",
  SUPABASE_ANON_KEY: "anon-key",
  IP_HASH_SECRET: "test-secret-0123456789",
  PUBLIC_URL: "https://api.example.com",
};
export const ORIGIN = env.PUBLIC_URL;

export const users: Record<string, AuthUser> = {
  "user-token": { id: "u1", email: "u@x.com", emailVerified: true, username: "player_one", role: "user" },
  "fresh-token": { id: "u2", email: "f@x.com", emailVerified: true, username: null, role: "user" },
  "unverified-token": { id: "u3", email: "n@x.com", emailVerified: false, username: "nobody", role: "user" },
  "admin-token": { id: "a1", email: "a@x.com", emailVerified: true, username: null, role: "admin" },
};

export function fakeAuth(overrides: Partial<AuthService> = {}): AuthService & { signedOut: string[] } {
  const signedOut: string[] = [];
  return {
    signedOut,
    authenticate: async (t) => users[t] ?? null,
    signIn: async (email, password) =>
      email === "a@x.com" && password === "correct-horse"
        ? { accessToken: "admin-token", refreshToken: "rt-admin", expiresIn: 3600 }
        : null,
    refresh: async (rt) =>
      rt === "rt-admin" ? { accessToken: "admin-token", refreshToken: "rt-admin-2", expiresIn: 3600 } : null,
    signOut: async (t) => {
      signedOut.push(t);
    },
    oauthUrl: (provider, redirectTo, challenge) =>
      `https://example.supabase.co/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirectTo)}&code_challenge=${challenge}&code_challenge_method=s256`,
    exchangeCode: async (code, verifier) =>
      code === "good-code" && verifier ? { accessToken: "user-token", refreshToken: "rt-user", expiresIn: 3600 } : null,
    ...overrides,
  };
}

/** In-memory stand-in for the Supabase-backed store, with the same rules (one review per user, unique usernames). */
export function fakeCommunity() {
  const names = new Map<string, string>(); // userId -> username
  const reviews = new Map<string, { id: string; userId: string; rating: number; body: string; status: ReviewStatus; createdAt: string; updatedAt: string }>();
  let seq = 0;
  const deletedAccounts: string[] = [];

  const toOwn = (r: { id: string; rating: number; body: string; status: ReviewStatus; createdAt: string; updatedAt: string }): OwnReview => ({
    id: r.id, rating: r.rating, body: r.body, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt,
  });

  const store: CommunityStore = {
    async listReviews({ limit, offset, status }) {
      const all = [...reviews.values()]
        .filter((r) => status === "all" || r.status === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const items: ReviewItem[] = all.slice(offset, offset + limit).map((r) => ({ ...toOwn(r), username: names.get(r.userId) ?? null }));
      return { items, total: all.length };
    },
    async summary() {
      const vis = [...reviews.values()].filter((r) => r.status === "visible");
      const d = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
      for (const r of vis) d[String(r.rating) as keyof typeof d]++;
      const avg = vis.length ? Math.round((vis.reduce((a, r) => a + r.rating, 0) / vis.length) * 100) / 100 : 0;
      return { count: vis.length, average: avg, distribution: d };
    },
    async getOwnReview(userId) {
      const r = reviews.get(userId);
      return r ? toOwn(r) : null;
    },
    async upsertReview(userId, rating, body) {
      const now = new Date(Date.UTC(2026, 0, 1, 0, 0, ++seq)).toISOString();
      const existing = reviews.get(userId);
      const r = existing
        ? { ...existing, rating, body, updatedAt: now } // an edit keeps the moderator's status
        : { id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, userId, rating, body, status: "visible" as const, createdAt: now, updatedAt: now };
      reviews.set(userId, r);
      return toOwn(r);
    },
    async deleteOwnReview(userId) {
      const r = reviews.get(userId);
      if (!r) return "none";
      if (r.status === "hidden") return "hidden";
      reviews.delete(userId);
      return "deleted";
    },
    async setUsername(userId, username) {
      for (const [id, n] of names) if (id !== userId && n.toLowerCase() === username.toLowerCase()) return "taken";
      names.set(userId, username);
      return "ok";
    },
    async setReviewStatus(id, status) {
      for (const r of reviews.values()) if (r.id === id) { r.status = status; return true; }
      return false;
    },
    async deleteReview(id) {
      for (const [uid, r] of reviews) if (r.id === id) { reviews.delete(uid); return true; }
      return false;
    },
    async deleteAccount(userId) {
      deletedAccounts.push(userId);
      reviews.delete(userId);
      names.delete(userId);
    },
  };
  return Object.assign(store, { names, reviews, deletedAccounts });
}

const unusedAnalytics = {
  downloads: async () => {
    throw new Error("unused");
  },
};

export async function makeApp(overrides: Record<string, string> = {}, authOverrides: Partial<AuthService> = {}) {
  const auth = fakeAuth(authOverrides);
  const community = fakeCommunity();
  // Usernames are looked up through the auth fake's users table, so keep the two in step.
  for (const u of Object.values(users)) if (u.username) community.names.set(u.id, u.username);
  const app = await buildApp(loadConfig({ ...env, ...overrides }), {
    auth,
    downloads: { record: async () => {} },
    analytics: unusedAnalytics,
    community,
  });
  return { app, auth, community };
}

export const post = (headers: Record<string, string> = { origin: ORIGIN }) => headers;
export const setCookies = (res: { headers: Record<string, unknown> }) =>
  [res.headers["set-cookie"]].flat().filter(Boolean) as string[];
