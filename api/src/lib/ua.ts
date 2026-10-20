export type Device = "android" | "ios" | "desktop" | "other";
export type BrowserFamily = "samsung" | "edge" | "opera" | "firefox" | "chrome" | "safari" | "other";

// Coarse buckets only: the raw user-agent string is never stored.
export function parseUserAgent(ua: string | undefined): { device: Device; family: BrowserFamily } {
  const s = ua ?? "";

  let device: Device = "other";
  if (/Android/i.test(s)) device = "android"; // before Linux: Android UAs contain "Linux"
  else if (/iPhone|iPad|iPod/i.test(s)) device = "ios";
  else if (/Windows|Macintosh|X11|Linux|CrOS/i.test(s)) device = "desktop";

  let family: BrowserFamily = "other";
  if (/SamsungBrowser/i.test(s)) family = "samsung";
  else if (/Edg(e|A|iOS)?\//i.test(s)) family = "edge";
  else if (/OPR\/|Opera/i.test(s)) family = "opera";
  else if (/Firefox|FxiOS/i.test(s)) family = "firefox";
  else if (/Chrome|CriOS/i.test(s)) family = "chrome";
  else if (/Safari/i.test(s)) family = "safari";

  return { device, family };
}
