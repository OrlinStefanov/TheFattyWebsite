import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Config } from "../config.js";
import type { AuthService } from "../plugins/auth.js";

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number(),
});

const TIMEOUT_MS = 10_000;

export function createSupabaseAuth(config: Config): AuthService {
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authUrl = `${config.SUPABASE_URL}/auth/v1`;

  // Plain REST calls instead of a shared supabase-js client: that client keeps the last signed-in
  // session in memory, which must never leak between different visitors.
  async function tokenRequest(grant: "password" | "refresh_token", body: object) {
    const res = await fetch(`${authUrl}/token?grant_type=${grant}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.SUPABASE_ANON_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) return null; // bad credentials / token
    if (!res.ok) throw new Error(`auth service answered ${res.status}`);
    const t = tokenResponse.parse(await res.json());
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in };
  }

  return {
    async authenticate(token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) return null;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();

      return {
        id: data.user.id,
        email: data.user.email ?? null,
        emailVerified: Boolean(data.user.email_confirmed_at),
        // Fail closed: anything other than an explicit 'admin' is a normal user.
        role: profile?.role === "admin" ? "admin" : "user",
      };
    },

    signIn: (email, password) => tokenRequest("password", { email, password }),
    refresh: (refreshToken) => tokenRequest("refresh_token", { refresh_token: refreshToken }),

    async signOut(accessToken) {
      await fetch(`${authUrl}/logout?scope=local`, {
        method: "POST",
        headers: { apikey: config.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => {});
    },
  };
}
