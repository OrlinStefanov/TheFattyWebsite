import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { AuthService, AuthUser } from "../src/plugins/auth.js";
import { fakeCommunity } from "./fakes.js";

const env = {
  NODE_ENV: "test",
  ALLOWED_ORIGIN: "https://example.github.io",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-key",
  SUPABASE_ANON_KEY: "anon-key",
  IP_HASH_SECRET: "test-secret-0123456789",
  PUBLIC_URL: "https://api.example.com",
};
const ORIGIN = "https://api.example.com";

const users: Record<string, AuthUser> = {
  "user-token": { id: "u1", email: "u@x.com", emailVerified: true, username: "player_one", role: "user" },
  "admin-token": { id: "a1", email: "a@x.com", emailVerified: true, username: null, role: "admin" },
};

const unusedAnalytics = {
  downloads: async () => {
    throw new Error("unused");
  },
};

async function setup(overrides: Record<string, string> = {}, authOverrides: Partial<AuthService> = {}) {
  const signedOut: string[] = [];
  const auth: AuthService = {
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
    oauthUrl: () => "https://example.supabase.co/auth/v1/authorize",
    exchangeCode: async () => null,
    ...authOverrides,
  };
  const app = await buildApp(loadConfig({ ...env, ...overrides }), {
    auth,
    downloads: { record: async () => {} },
    analytics: unusedAnalytics,
    community: fakeCommunity(),
  });
  return { app, signedOut };
}

type App = Awaited<ReturnType<typeof setup>>["app"];

const login = (app: App, payload: object, headers: Record<string, string> = { origin: ORIGIN }) =>
  app.inject({ method: "POST", url: "/api/auth/login", payload, headers });

const setCookies = (res: { headers: Record<string, unknown> }) =>
  [res.headers["set-cookie"]].flat().filter(Boolean) as string[];

describe("login", () => {
  it("sets HttpOnly SameSite=Strict cookies and never returns the tokens", async () => {
    const { app } = await setup();
    const res = await login(app, { email: "a@x.com", password: "correct-horse" });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(2);
    for (const c of cookies) {
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/SameSite=Strict/i);
      expect(c).toMatch(/Path=\//);
    }
    expect(cookies.find((c) => c.startsWith("fatty_at="))).toContain("admin-token");
  });

  it("in production uses Secure __Host- cookies", async () => {
    const { app } = await setup({ NODE_ENV: "production" });
    const cookies = setCookies(await login(app, { email: "a@x.com", password: "correct-horse" }));
    expect(cookies.map((c) => c.split("=")[0]).sort()).toEqual(["__Host-fatty_at", "__Host-fatty_rt"]);
    for (const c of cookies) {
      expect(c).toMatch(/Secure/i);
      expect(c).not.toMatch(/Domain=/i);
    }
  });

  it("answers the same for a wrong password and an unknown email", async () => {
    const { app } = await setup();
    const a = await login(app, { email: "a@x.com", password: "wrong" });
    const b = await login(app, { email: "nobody@x.com", password: "wrong" });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.body).toBe(b.body);
    expect(setCookies(a)).toHaveLength(0);
  });

  it("rejects a foreign or missing Origin (CSRF)", async () => {
    const { app } = await setup();
    const body = { email: "a@x.com", password: "correct-horse" };
    expect((await login(app, body, { origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await login(app, body, {})).statusCode).toBe(403);
    // Even the site allowed to call the public endpoints may not log in cross-site.
    expect((await login(app, body, { origin: env.ALLOWED_ORIGIN })).statusCode).toBe(403);
  });

  it("validates the body", async () => {
    const { app } = await setup();
    expect((await login(app, { email: "not-an-email", password: "x" })).statusCode).toBe(400);
    expect((await login(app, { email: "a@x.com" })).statusCode).toBe(400);
    expect((await login(app, { email: "a@x.com", password: "x".repeat(201) })).statusCode).toBe(400);
  });

  it("rate limits repeated attempts", async () => {
    const { app } = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await login(app, { email: "a@x.com", password: "wrong" })).statusCode);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[6]).toBe(429);
  });

  it("answers 503 when the auth service is down", async () => {
    const { app } = await setup({}, {
      signIn: async () => {
        throw new Error("down");
      },
    });
    expect((await login(app, { email: "a@x.com", password: "x" })).statusCode).toBe(503);
  });
});

describe("per-account login throttle", () => {
  it("locks an email after repeated failures even when the attacker rotates IPs", async () => {
    const { app } = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({
        method: "POST", url: "/api/auth/login", remoteAddress: `10.1.0.${i + 1}`,
        headers: { origin: ORIGIN }, payload: { email: "a@x.com", password: `guess-${i}` },
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    // Even the right password is refused while locked; another account is unaffected.
    const locked = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: "10.1.0.50",
      headers: { origin: ORIGIN }, payload: { email: "a@x.com", password: "correct-horse" } });
    expect(locked.statusCode).toBe(429);
    const other = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: "10.1.0.51",
      headers: { origin: ORIGIN }, payload: { email: "other@x.com", password: "nope" } });
    expect(other.statusCode).toBe(401);
  });
});

describe("cookie sessions", () => {
  it("authenticates from the access cookie", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/me", cookies: { fatty_at: "user-token" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("user");
  });

  it("refreshes silently when only the refresh cookie is valid", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "GET", url: "/api/me", cookies: { fatty_at: "expired", fatty_rt: "rt-admin" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("admin");
    expect(setCookies(res).find((c) => c.startsWith("fatty_rt="))).toContain("rt-admin-2");
  });

  it("clears the cookies when the refresh token is rejected", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/me", cookies: { fatty_rt: "rt-stolen" } });
    expect(res.statusCode).toBe(401);
    const cleared = setCookies(res);
    expect(cleared.length).toBeGreaterThan(0);
    for (const c of cleared) expect(c).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });

  it("keeps the cookies when the auth service is down", async () => {
    const { app } = await setup({}, {
      refresh: async () => {
        throw new Error("down");
      },
    });
    const res = await app.inject({ method: "GET", url: "/api/me", cookies: { fatty_rt: "rt-admin" } });
    expect(res.statusCode).toBe(401);
    expect(setCookies(res)).toHaveLength(0);
  });

  it("a bad bearer token is not rescued by a valid cookie", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "GET", url: "/api/me", headers: { authorization: "Bearer nope" }, cookies: { fatty_at: "admin-token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("logout revokes the session and clears the cookies", async () => {
    const { app, signedOut } = await setup();
    const res = await app.inject({
      method: "POST", url: "/api/auth/logout", headers: { origin: ORIGIN }, cookies: { fatty_at: "admin-token" },
    });
    expect(res.statusCode).toBe(204);
    expect(signedOut).toEqual(["admin-token"]);
    expect(setCookies(res).length).toBeGreaterThan(0);
  });

  it("logout still revokes the session when only the refresh cookie is left", async () => {
    const { app, signedOut } = await setup();
    const res = await app.inject({
      method: "POST", url: "/api/auth/logout", headers: { origin: ORIGIN }, cookies: { fatty_rt: "rt-admin" },
    });
    expect(res.statusCode).toBe(204);
    expect(signedOut).toEqual(["admin-token"]);
  });

  it("parallel requests share one refresh", async () => {
    let calls = 0;
    const { app } = await setup({}, {
      refresh: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 30));
        return { accessToken: "admin-token", refreshToken: "rt-next", expiresIn: 3600 };
      },
    });
    const req = () => app.inject({ method: "GET", url: "/api/me", cookies: { fatty_rt: "rt-admin" } });
    const results = await Promise.all([req(), req(), req()]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(calls).toBe(1);
  });

  it("logout needs the right Origin", async () => {
    const { app, signedOut } = await setup();
    const res = await app.inject({
      method: "POST", url: "/api/auth/logout", headers: { origin: "https://evil.example" }, cookies: { fatty_at: "admin-token" },
    });
    expect(res.statusCode).toBe(403);
    expect(signedOut).toEqual([]);
  });
});

describe("headers and static files", () => {
  it("serves the admin pages with a strict CSP", async () => {
    const { app } = await setup({ NODE_ENV: "production" });
    const res = await app.inject({ method: "GET", url: "/admin/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/google|gstatic/); // fonts are self-hosted
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect((await app.inject({ method: "GET", url: "/admin/login.html" })).statusCode).toBe(200);
  });

  it("serves the self-hosted fonts the admin pages need", async () => {
    const { app } = await setup();
    for (const f of ["inter-latin.woff2", "press-start-2p-latin.woff2"]) {
      const res = await app.inject({ method: "GET", url: `/shared/fonts/${f}` });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/font\/woff2/);
      expect(res.rawPayload.subarray(0, 4).toString()).toBe("wOF2");
    }
  });

  it("has no inline scripts or styles in the admin pages (the CSP would block them)", async () => {
    const { app } = await setup();
    for (const url of ["/admin/", "/admin/login.html"]) {
      const html = (await app.inject({ method: "GET", url })).body;
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
      expect(html).not.toMatch(/<style/i);
      expect(html).not.toMatch(/\sstyle\s*=/i);
    }
  });

  it("never caches API answers", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/me", cookies: { fatty_at: "user-token" } });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("does not leak files outside the public folder", async () => {
    const { app } = await setup();
    for (const url of ["/admin/../src/app.ts", "/..%2fsrc%2fapp.ts", "/admin/%2e%2e/package.json", "/package.json", "/.env"]) {
      expect([400, 403, 404]).toContain((await app.inject({ method: "GET", url })).statusCode);
    }
  });

  it("does not allow credentialed cross-origin requests", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/health", headers: { origin: env.ALLOWED_ORIGIN } });
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});
