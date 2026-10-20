import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { AuthService, AuthUser } from "../src/plugins/auth.js";

const config = loadConfig({
  NODE_ENV: "test",
  ALLOWED_ORIGIN: "https://example.github.io",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-key",
});

const users: Record<string, AuthUser> = {
  "user-token": { id: "u1", email: "u@x.com", emailVerified: true, role: "user" },
  "admin-token": { id: "a1", email: "a@x.com", emailVerified: true, role: "admin" },
};
const fakeAuth: AuthService = { authenticate: async (t) => users[t] ?? null };

const get = async (url: string, headers: Record<string, string> = {}) => {
  const app = await buildApp(config, fakeAuth);
  return app.inject({ method: "GET", url, headers });
};

describe("config", () => {
  it("rejects missing env", () => {
    expect(() => loadConfig({})).toThrow(/Invalid environment/);
  });
});

describe("health", () => {
  it("is public", async () => {
    const res = await get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("admin routes", () => {
  it("401 without a token", async () => {
    expect((await get("/api/admin/ping")).statusCode).toBe(401);
  });
  it("401 with an invalid token", async () => {
    const res = await get("/api/admin/ping", { authorization: "Bearer nope" });
    expect(res.statusCode).toBe(401);
  });
  it("401 with a non-bearer scheme", async () => {
    const res = await get("/api/admin/ping", { authorization: "Basic admin-token" });
    expect(res.statusCode).toBe(401);
  });
  it("403 for a normal user", async () => {
    const res = await get("/api/admin/ping", { authorization: "Bearer user-token" });
    expect(res.statusCode).toBe(403);
  });
  it("200 for an admin", async () => {
    const res = await get("/api/admin/ping", { authorization: "Bearer admin-token" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, userId: "a1" });
  });
});

describe("docs", () => {
  it("serves Scalar and an OpenAPI spec outside production", async () => {
    expect((await get("/docs/")).statusCode).toBe(200);
    const spec = (await get("/docs/openapi.json")).json();
    expect(spec.paths["/api/admin/ping"].get.security).toEqual([{ bearerAuth: [] }]);
  });
  it("is not served in production", async () => {
    const prod = { ...config, NODE_ENV: "production" as const };
    const app = await buildApp(prod, fakeAuth);
    expect((await app.inject({ method: "GET", url: "/docs" })).statusCode).toBe(404);
  });
});

describe("cors", () => {
  it("allows only the configured origin", async () => {
    const ok = await get("/health", { origin: "https://example.github.io" });
    expect(ok.headers["access-control-allow-origin"]).toBe("https://example.github.io");
    const bad = await get("/health", { origin: "https://evil.example" });
    // Fixed allow-list: the header never echoes a foreign origin, so browsers block it.
    expect(bad.headers["access-control-allow-origin"]).toBe("https://example.github.io");
  });
});
