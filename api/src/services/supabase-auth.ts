import { createClient } from "@supabase/supabase-js";
import type { Config } from "../config.js";
import type { AuthService } from "../plugins/auth.js";

export function createSupabaseAuth(config: Config): AuthService {
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
  };
}
