import { z } from "zod";

// Words that would let someone pose as staff or the game. Long words are blocked anywhere in the
// name; short ones ("mod") would catch innocent names like "Modric", so they only count as a whole
// underscore-separated part ("mod_x", "x_mod", "team_fatty").
const BLOCKED_ANYWHERE = ["admin", "moderator", "staff", "official", "support", "thefatty", "system", "owner"];
const BLOCKED_AS_PART = ["mod", "dev", "team", "gm", "staff", "root"];

// Look-alikes are folded to plain letters first, so "adm1n" or "Th3Fatty" are caught too.
const LOOKALIKES: Record<string, string> = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", i: "l" };
const fold = (s: string) => s.toLowerCase().replace(/[013457i]/g, (c) => LOOKALIKES[c] ?? c);

export function isReservedUsername(name: string): boolean {
  const flat = fold(name.replace(/_/g, ""));
  if (BLOCKED_ANYWHERE.some((w) => flat.includes(fold(w)))) return true;
  return name.split("_").some((part) => BLOCKED_AS_PART.some((w) => fold(part) === fold(w)));
}

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{3,30}$/, "3-30 characters: letters, digits and underscore only")
  .refine((u) => !isReservedUsername(u), "That name is reserved");
