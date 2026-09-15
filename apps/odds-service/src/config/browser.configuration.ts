import { resolve } from "node:path";
export interface BrowserSettings {
  runtime: "local-cdp" | "disabled";
  mode: "headless" | "headed";
  channel: "chrome";
  profileDir: string;
  persistent: boolean;
  sharedInstance: true;
  sharedContext: true;
  mainTab: true;
  detailTabMax: 0 | 1;
  locale: string;
  timezone: string;
  viewport: { width: number; height: number };
  evidenceDir: string;
}
export function browserConfiguration(): BrowserSettings {
  const runtime = process.env.BROWSER_RUNTIME ?? "disabled";
  if (runtime !== "local-cdp" && runtime !== "disabled")
    throw Error("Invalid BROWSER_RUNTIME");
  const mode =
    process.env.BROWSER_MODE ??
    (["false", "0"].includes(process.env.HEADLESS ?? "false")
      ? "headed"
      : "headless");
  if (mode !== "headed" && mode !== "headless")
    throw Error("Invalid BROWSER_MODE");
  const channel = process.env.CHROME_CHANNEL ?? "chrome";
  if (channel !== "chrome")
    throw Error("CHROME_CHANNEL must be chrome (Stable)");
  const persistent = process.env.BROWSER_PERSISTENT ?? "true";
  if (!["true", "false", "1", "0"].includes(persistent))
    throw Error("Invalid BROWSER_PERSISTENT");
  for (const key of [
    "BROWSER_SHARED_INSTANCE",
    "BROWSER_SHARED_CONTEXT",
    "PROVIDER_MAIN_TAB",
  ])
    if (!["true", "1"].includes(process.env[key] ?? "true"))
      throw Error(
        key + " must be true; separate browsers/contexts are unsupported",
      );
  const detailTabMax = Number(process.env.PROVIDER_DETAIL_TAB_MAX ?? 1);
  if (detailTabMax !== 0 && detailTabMax !== 1)
    throw Error("Invalid PROVIDER_DETAIL_TAB_MAX");
  const size = (key: string, fallback: number) => {
    const n = Number(process.env[key] ?? fallback);
    if (!Number.isSafeInteger(n) || n < 320 || n > 7680)
      throw Error("Invalid " + key);
    return n;
  };
  const locale = process.env.BROWSER_LOCALE ?? "pt-BR";
  const timezone = process.env.BROWSER_TIMEZONE ?? "America/Sao_Paulo";
  new Intl.DateTimeFormat(locale, { timeZone: timezone }).format();
  return {
    runtime,
    mode,
    sharedInstance: true,
    sharedContext: true,
    mainTab: true,
    detailTabMax,
    channel,
    persistent: ["true", "1"].includes(persistent),
    profileDir: resolve(
      process.env.BROWSER_PROFILE_DIR ?? "data/chrome-profile",
    ),
    locale,
    timezone,
    viewport: {
      width: size("BROWSER_VIEWPORT_WIDTH", 1440),
      height: size("BROWSER_VIEWPORT_HEIGHT", 900),
    },
    evidenceDir: resolve(
      process.env.BROWSER_EVIDENCE_DIR ?? "evidence/browser",
    ),
  };
}
