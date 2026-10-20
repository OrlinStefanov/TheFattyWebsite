import { createHash } from "node:crypto";

/**
 * Failed-login limiter per account (the per-IP limit alone does not stop a distributed attack on
 * one email). In memory, which is fine for a single instance. Trade-off: someone can deliberately
 * lock an account for a while by failing on purpose; that costs the owner a short wait, whereas
 * unlimited guessing could cost the account.
 */
export function createLoginThrottle(max = 10, windowMs = 15 * 60_000, now: () => number = Date.now) {
  const entries = new Map<string, { failures: number; resetAt: number }>();
  const key = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

  return {
    blocked(email: string): boolean {
      const k = key(email);
      const e = entries.get(k);
      if (!e) return false;
      if (e.resetAt <= now()) {
        entries.delete(k);
        return false;
      }
      return e.failures >= max;
    },
    fail(email: string): void {
      const k = key(email);
      const t = now();
      const e = entries.get(k);
      if (!e || e.resetAt <= t) entries.set(k, { failures: 1, resetAt: t + windowMs });
      else e.failures++;
      if (entries.size > 10_000) entries.clear(); // memory bound under a flood of random emails
    },
    succeed(email: string): void {
      entries.delete(key(email));
    },
  };
}
