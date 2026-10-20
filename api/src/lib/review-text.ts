import { z } from "zod";

// Control characters (except newline) and invisible/bidirectional formatting characters are removed:
// they are used to spoof text direction or hide content. Everything else is kept verbatim and is
// only ever shown as plain text by the frontend.
const INVISIBLE = /[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁠-⁩﻿]/g;

export function normalizeReviewBody(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(INVISIBLE, "").replace(/\n{3,}/g, "\n\n").trim();
}

export const reviewBodySchema = z
  .string()
  .max(4000) // generous cap before normalising, so a huge payload is rejected cheaply
  .transform(normalizeReviewBody)
  .pipe(z.string().min(1, "Write something").max(1000, "At most 1000 characters"));
