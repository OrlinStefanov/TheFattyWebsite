import { describe, expect, it } from "vitest";
import { normalizeReviewBody } from "../src/lib/review-text.js";
import { usernameSchema } from "../src/lib/usernames.js";
import { ORIGIN, makeApp, setCookies } from "./fakes.js";

type Ctx = Awaited<ReturnType<typeof makeApp>>;

const as = (token: string) => ({ cookies: { fatty_at: token } });
const put = (app: Ctx["app"], token: string, payload: object, headers: Record<string, string> = { origin: ORIGIN }) =>
  app.inject({ method: "PUT", url: "/api/reviews/me", payload, headers, ...as(token) });

describe("OAuth sign-in", () => {
  it("starts with a PKCE challenge and a Lax, HttpOnly verifier cookie", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/auth/oauth/discord" });
    expect(res.statusCode).toBe(302);
    const target = new URL(String(res.headers.location));
    expect(target.origin + target.pathname).toBe("https://example.supabase.co/auth/v1/authorize");
    expect(target.searchParams.get("provider")).toBe("discord");
    expect(target.searchParams.get("code_challenge_method")).toBe("s256");
    expect(target.searchParams.get("redirect_to")).toBe(`${ORIGIN}/api/auth/callback`);
    const cookie = setCookies(res).find((c) => c.startsWith("fatty_pkce="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    // Only the hash of the verifier leaves this server, never the verifier itself.
    const verifier = cookie.split(";")[0]!.split("=")[1]!;
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(target.toString()).not.toContain(verifier);
    expect(target.searchParams.get("code_challenge")).not.toBe(verifier);
  });

  it("accepts only google and discord", async () => {
    const { app } = await makeApp();
    for (const p of ["github", "evil", "..%2f", "DISCORD"]) {
      expect((await app.inject({ method: "GET", url: `/api/auth/oauth/${p}` })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "GET", url: "/api/auth/oauth/google" })).statusCode).toBe(302);
  });

  it("uses Secure __Host- cookies in production", async () => {
    const { app } = await makeApp({ NODE_ENV: "production" });
    const res = await app.inject({ method: "GET", url: "/api/auth/oauth/google" });
    const cookie = setCookies(res).find((c) => c.startsWith("__Host-fatty_pkce="))!;
    expect(cookie).toMatch(/Secure/i);
  });

  it("callback exchanges the code, sets the session cookies and clears the verifier", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/auth/callback?code=good-code", cookies: { fatty_pkce: "verifier123" } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/community/");
    const cookies = setCookies(res);
    expect(cookies.find((c) => c.startsWith("fatty_at="))).toMatch(/HttpOnly.*SameSite=Strict|SameSite=Strict.*HttpOnly/i);
    expect(cookies.find((c) => c.startsWith("fatty_rt="))).toBeTruthy();
    expect(cookies.find((c) => c.startsWith("fatty_pkce="))).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });

  it.each([
    ["no verifier cookie (sign-in started elsewhere)", "/api/auth/callback?code=good-code", {}],
    ["no code", "/api/auth/callback", { fatty_pkce: "v" }],
    ["provider error", "/api/auth/callback?error=access_denied&code=good-code", { fatty_pkce: "v" }],
    ["rejected code", "/api/auth/callback?code=bad-code", { fatty_pkce: "v" }],
  ])("callback fails closed: %s", async (_label, url, cookies) => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "GET", url, cookies });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/community/?error=login");
    expect(setCookies(res).some((c) => c.startsWith("fatty_at="))).toBe(false);
  });

  it("never redirects anywhere but the fixed local pages", async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: "GET", url: "/api/auth/callback?code=good-code&next=https://evil.example&redirect_to=https://evil.example",
      cookies: { fatty_pkce: "v" },
    });
    expect(res.headers.location).toBe("/community/");
  });

  it("callback survives the auth service failing", async () => {
    const { app } = await makeApp({}, { exchangeCode: async () => { throw new Error("down"); } });
    const res = await app.inject({ method: "GET", url: "/api/auth/callback?code=good-code", cookies: { fatty_pkce: "v" } });
    expect(res.headers.location).toBe("/community/?error=login");
  });
});

describe("username", () => {
  const patch = (app: Ctx["app"], token: string, username: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
    app.inject({ method: "PATCH", url: "/api/profile", payload: { username }, headers, ...as(token) });

  it("is set by a signed-in user", async () => {
    const { app } = await makeApp();
    const res = await patch(app, "fresh-token", "Zed_99");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ username: "Zed_99" });
  });

  it("requires a session and the right Origin", async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: "PATCH", url: "/api/profile", payload: { username: "Zed_99" }, headers: { origin: ORIGIN } })).statusCode).toBe(401);
    expect((await patch(app, "fresh-token", "Zed_99", { origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await patch(app, "fresh-token", "Zed_99", {})).statusCode).toBe(403);
  });

  it("is unique ignoring case", async () => {
    const { app } = await makeApp();
    const res = await patch(app, "fresh-token", "PLAYER_ONE");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "username_taken" });
  });

  it.each(["ab", "a".repeat(31), "has space", "emoji😀name", "dots.not.ok", "semi;colon", "<script>", "", "   "])(
    "rejects invalid name %j", async (name) => {
      const { app } = await makeApp();
      expect((await patch(app, "fresh-token", name)).statusCode).toBe(400);
    },
  );

  it.each([
    "admin", "Administrator", "xX_Admin_Xx", "the_fatty", "TheFatty", "Moderator1", "official_dev", "SUPPORT_team", "ad_min",
    // look-alike spellings
    "adm1n", "Adm1nistrator", "Th3Fatty", "supp0rt", "m0derator", "0wner", "Admln", "AdmIn",
    // short staff words as a whole part of the name
    "mod_x", "x_mod", "dev_bob", "team_fatty_2", "Mod",
  ])(
    "blocks names that pose as staff or the game: %s", async (name) => {
      const { app } = await makeApp();
      expect((await patch(app, "fresh-token", name)).statusCode).toBe(400);
    },
  );

  it.each(["Modric", "ModernGamer", "Devon", "Teammate", "Rootbeer", "Mod2", "Admiral", "Zed_99", "Marta_K"])(
    "does not block ordinary names that merely contain a staff word: %s", async (name) => {
      const { app } = await makeApp();
      expect((await patch(app, "fresh-token", name)).statusCode).toBe(200);
    },
  );

  it("needs a verified email, so unverified accounts cannot squat names", async () => {
    const { app } = await makeApp();
    const res = await patch(app, "unverified-token", "Squatter_1");
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "email_not_verified" });
  });

  it("schema trims surrounding spaces but nothing else", () => {
    expect(usernameSchema.parse("  Zed_99  ")).toBe("Zed_99");
    expect(usernameSchema.safeParse("Zed 99").success).toBe(false);
  });
});

describe("public reviews", () => {
  it("lists visible reviews without ids or moderation fields, and is never cached", async () => {
    const { app } = await makeApp();
    await put(app, "user-token", { rating: 5, body: "Great game" });
    const res = await app.inject({ method: "GET", url: "/api/reviews" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const { items, total } = res.json();
    expect(total).toBe(1);
    expect(Object.keys(items[0]).sort()).toEqual(["body", "createdAt", "rating", "updatedAt", "username"]);
    expect(items[0].username).toBe("player_one");
  });

  it("needs no login and no cookies, and allows the site origin to read it", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/reviews/summary", headers: { origin: "https://example.github.io" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ count: 0, average: 0, distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } });
    expect(res.headers["access-control-allow-origin"]).toBe("https://example.github.io");
  });

  it("paginates and validates the paging parameters", async () => {
    const { app, community } = await makeApp();
    for (let i = 0; i < 3; i++) await community.upsertReview(`user-${i}`, 4, `review ${i}`);
    const page = (await app.inject({ method: "GET", url: "/api/reviews?limit=2&offset=0" })).json();
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
    for (const bad of ["limit=0", "limit=51", "limit=abc", "offset=-1", "offset=10001", "limit=1.5"]) {
      expect((await app.inject({ method: "GET", url: `/api/reviews?${bad}` })).statusCode).toBe(400);
    }
  });

  it("computes the summary from visible reviews only", async () => {
    const { app, community } = await makeApp();
    await community.upsertReview("a", 5, "x");
    await community.upsertReview("b", 3, "y");
    const hidden = await community.upsertReview("c", 1, "z");
    await community.setReviewStatus(hidden.id, "hidden");
    const s = (await app.inject({ method: "GET", url: "/api/reviews/summary" })).json();
    expect(s.count).toBe(2);
    expect(s.average).toBe(4);
    expect(s.distribution).toEqual({ "1": 0, "2": 0, "3": 1, "4": 0, "5": 1 });
  });
});

describe("writing a review", () => {
  it("requires a session", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "PUT", url: "/api/reviews/me", payload: { rating: 5, body: "x" }, headers: { origin: ORIGIN } });
    expect(res.statusCode).toBe(401);
  });

  it("requires the site's own Origin (CSRF)", async () => {
    const { app } = await makeApp();
    expect((await put(app, "user-token", { rating: 5, body: "x" }, { origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await put(app, "user-token", { rating: 5, body: "x" }, {})).statusCode).toBe(403);
  });

  it("needs a username and a verified email", async () => {
    const { app } = await makeApp();
    const noName = await put(app, "fresh-token", { rating: 5, body: "x" });
    expect(noName.statusCode).toBe(403);
    expect(noName.json()).toEqual({ error: "username_required" });
    const unverified = await put(app, "unverified-token", { rating: 5, body: "x" });
    expect(unverified.statusCode).toBe(403);
    expect(unverified.json()).toEqual({ error: "email_not_verified" });
  });

  it("saves one review per account and an edit replaces it", async () => {
    const { app, community } = await makeApp();
    const first = await put(app, "user-token", { rating: 4, body: "Fun" });
    expect(first.statusCode).toBe(200);
    expect(first.json().review).toMatchObject({ rating: 4, body: "Fun", status: "visible" });
    await put(app, "user-token", { rating: 2, body: "Got harder" });
    expect(community.reviews.size).toBe(1);
    const mine = (await app.inject({ method: "GET", url: "/api/reviews/me", ...as("user-token") })).json();
    expect(mine.review).toMatchObject({ rating: 2, body: "Got harder" });
  });

  it("an edit does not undo a moderator hiding the review", async () => {
    const { app, community } = await makeApp();
    const r = await community.upsertReview("u1", 5, "first");
    await community.setReviewStatus(r.id, "hidden");
    const res = await put(app, "user-token", { rating: 5, body: "edited" });
    expect(res.json().review.status).toBe("hidden");
    expect((await app.inject({ method: "GET", url: "/api/reviews" })).json().total).toBe(0);
  });

  it.each([0, 6, 1.5, -1, "5", null])("rejects rating %j", async (rating) => {
    const { app } = await makeApp();
    expect((await put(app, "user-token", { rating, body: "ok" })).statusCode).toBe(400);
  });

  it.each(["", "   ", "\n\n\t", "x".repeat(1001), "x".repeat(5000)])("rejects body of length %#", async (body) => {
    const { app } = await makeApp();
    expect((await put(app, "user-token", { rating: 5, body })).statusCode).toBe(400);
  });

  it("rejects a missing or non-string body", async () => {
    const { app } = await makeApp();
    expect((await put(app, "user-token", { rating: 5 })).statusCode).toBe(400);
    expect((await put(app, "user-token", { rating: 5, body: { $ne: "" } })).statusCode).toBe(400);
  });

  it("accepts exactly 1000 characters", async () => {
    const { app } = await makeApp();
    expect((await put(app, "user-token", { rating: 5, body: "x".repeat(1000) })).statusCode).toBe(200);
  });

  it("strips control and bidi-spoofing characters and tidies whitespace", async () => {
    const { app } = await makeApp();
    const dirty = "  Hello‮evil​ world\u0000\r\n\r\n\r\n\r\nbye\u0007  ";
    const res = await put(app, "user-token", { rating: 5, body: dirty });
    expect(res.json().review.body).toBe("Helloevil world\n\nbye");
    expect(normalizeReviewBody("a\r\nb")).toBe("a\nb");
  });

  it("stores markup as inert text and returns it as JSON (the pages render with textContent)", async () => {
    const { app } = await makeApp();
    const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    await put(app, "user-token", { rating: 1, body: payload });
    const res = await app.inject({ method: "GET", url: "/api/reviews" });
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.json().items[0].body).toBe(payload);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("rate limits rapid writes", async () => {
    const { app } = await makeApp();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await put(app, "user-token", { rating: 5, body: `v${i}` })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[11]).toBe(429);
  });

  it("a review a moderator hid cannot be deleted and reposted as visible", async () => {
    const { app, community } = await makeApp();
    const r = await community.upsertReview("u1", 1, "abusive text");
    await community.setReviewStatus(r.id, "hidden");
    const res = await app.inject({ method: "DELETE", url: "/api/reviews/me", headers: { origin: ORIGIN }, ...as("user-token") });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "hidden_by_moderator" });
    expect(community.reviews.get("u1")!.status).toBe("hidden");
    // Editing keeps it hidden too, so there is no route back to visible for the author.
    expect((await put(app, "user-token", { rating: 5, body: "new text" })).json().review.status).toBe("hidden");
    expect((await app.inject({ method: "GET", url: "/api/reviews" })).json().total).toBe(0);
  });

  it("deletes your own review", async () => {
    const { app, community } = await makeApp();
    await put(app, "user-token", { rating: 5, body: "bye" });
    const res = await app.inject({ method: "DELETE", url: "/api/reviews/me", headers: { origin: ORIGIN }, ...as("user-token") });
    expect(res.statusCode).toBe(204);
    expect(community.reviews.size).toBe(0);
    const foreign = await app.inject({ method: "DELETE", url: "/api/reviews/me", headers: { origin: "https://evil.example" }, ...as("user-token") });
    expect(foreign.statusCode).toBe(403);
  });
});

describe("account deletion", () => {
  it("removes the account and its review, and clears the cookies", async () => {
    const { app, community } = await makeApp();
    await put(app, "user-token", { rating: 5, body: "x" });
    const res = await app.inject({ method: "DELETE", url: "/api/me", headers: { origin: ORIGIN }, ...as("user-token") });
    expect(res.statusCode).toBe(204);
    expect(community.deletedAccounts).toEqual(["u1"]);
    expect(community.reviews.size).toBe(0);
    expect(setCookies(res).length).toBeGreaterThan(0);
  });

  it("needs a session and the right Origin", async () => {
    const { app, community } = await makeApp();
    expect((await app.inject({ method: "DELETE", url: "/api/me", headers: { origin: ORIGIN } })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: "/api/me", headers: { origin: "https://evil.example" }, ...as("user-token") })).statusCode).toBe(403);
    expect(community.deletedAccounts).toEqual([]);
  });

  it("will not delete an admin by accident", async () => {
    const { app, community } = await makeApp();
    const res = await app.inject({ method: "DELETE", url: "/api/me", headers: { origin: ORIGIN }, ...as("admin-token") });
    expect(res.statusCode).toBe(403);
    expect(community.deletedAccounts).toEqual([]);
  });
});

describe("moderation (admin only)", () => {
  const admin = (app: Ctx["app"], method: "GET" | "PATCH" | "DELETE", url: string, payload?: object, headers: Record<string, string> = { origin: ORIGIN }) =>
    app.inject({ method, url, payload, headers, ...as("admin-token") });

  it("is closed to anonymous visitors and normal users", async () => {
    const { app, community } = await makeApp();
    const r = await community.upsertReview("x", 5, "hi");
    for (const [method, url, payload] of [
      ["GET", "/api/admin/reviews", undefined],
      ["PATCH", `/api/admin/reviews/${r.id}`, { status: "hidden" }],
      ["DELETE", `/api/admin/reviews/${r.id}`, undefined],
    ] as const) {
      expect((await app.inject({ method, url, payload, headers: { origin: ORIGIN } })).statusCode).toBe(401);
      expect((await app.inject({ method, url, payload, headers: { origin: ORIGIN }, ...as("user-token") })).statusCode).toBe(403);
    }
    expect(community.reviews.get("x")!.status).toBe("visible");
  });

  it("hides, lists and unhides a review", async () => {
    const { app, community } = await makeApp();
    const r = await community.upsertReview("u1", 2, "meh");
    expect((await admin(app, "PATCH", `/api/admin/reviews/${r.id}`, { status: "hidden" })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/reviews" })).json().total).toBe(0);
    const all = (await admin(app, "GET", "/api/admin/reviews")).json();
    expect(all.items[0]).toMatchObject({ id: r.id, status: "hidden", username: "player_one" });
    expect((await admin(app, "GET", "/api/admin/reviews?status=visible")).json().total).toBe(0);
    await admin(app, "PATCH", `/api/admin/reviews/${r.id}`, { status: "visible" });
    expect((await app.inject({ method: "GET", url: "/api/reviews" })).json().total).toBe(1);
  });

  it("deletes a review and reports unknown ids", async () => {
    const { app, community } = await makeApp();
    const r = await community.upsertReview("x", 3, "spam");
    expect((await admin(app, "DELETE", `/api/admin/reviews/${r.id}`)).statusCode).toBe(204);
    expect((await admin(app, "DELETE", `/api/admin/reviews/${r.id}`)).statusCode).toBe(404);
    expect((await admin(app, "PATCH", "/api/admin/reviews/00000000-0000-4000-8000-00000000ffff", { status: "hidden" })).statusCode).toBe(404);
  });

  it("validates ids and statuses", async () => {
    const { app } = await makeApp();
    expect((await admin(app, "PATCH", "/api/admin/reviews/not-a-uuid", { status: "hidden" })).statusCode).toBe(400);
    expect((await admin(app, "PATCH", "/api/admin/reviews/00000000-0000-4000-8000-000000000001", { status: "deleted" })).statusCode).toBe(400);
    expect((await admin(app, "DELETE", "/api/admin/reviews/1%27%20OR%20%271%27=%271")).statusCode).toBe(400);
    expect((await admin(app, "GET", "/api/admin/reviews?status=bogus")).statusCode).toBe(400);
  });

  it("state-changing admin requests need the site's own Origin (CSRF)", async () => {
    const { app, community } = await makeApp();
    const r = await community.upsertReview("x", 5, "hi");
    expect((await admin(app, "PATCH", `/api/admin/reviews/${r.id}`, { status: "hidden" }, { origin: "https://evil.example" })).statusCode).toBe(403);
    expect((await admin(app, "DELETE", `/api/admin/reviews/${r.id}`, undefined, {})).statusCode).toBe(403);
    expect(community.reviews.get("x")!.status).toBe("visible");
  });
});

describe("served pages", () => {
  it("serves the community page and shared assets with the strict headers, indexable only on the website", async () => {
    const { app } = await makeApp({ NODE_ENV: "production" });
    for (const url of ["/community/", "/shared/app.css", "/shared/api.js"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["x-robots-tag"], url).toBe("noindex, nofollow");
      expect(res.headers["cache-control"], url).toBe("no-cache");
    }
    const csp = String((await app.inject({ method: "GET", url: "/community/" })).headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
  });

  it("the community page has no inline scripts, styles or handlers (the CSP would block them)", async () => {
    const { app } = await makeApp();
    const html = (await app.inject({ method: "GET", url: "/community/" })).body;
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
  });
});

describe("error handling", () => {
  it("never leaks internal messages on a server error", async () => {
    const { app, community } = await makeApp();
    community.summary = async () => {
      throw new Error('relation "public.reviews" violates constraint "reviews_rating_check"');
    };
    const res = await app.inject({ method: "GET", url: "/api/reviews/summary" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal" });
    expect(res.body).not.toMatch(/relation|constraint|reviews_rating/);
  });

  it("keeps 4xx answers short and generic", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/reviews?limit=abc" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad_request", message: "Invalid request" });
  });
});
