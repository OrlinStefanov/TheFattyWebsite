import { createHmac } from "node:crypto";

/**
 * Keyed hash of the client IP. The key includes the UTC date, so the same visitor hashes
 * differently each day: counts of unique daily visitors work, long-term tracking does not.
 */
export function hashIp(ip: string, secret: string, now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  return createHmac("sha256", `${secret}:${day}`).update(ip).digest("hex");
}
