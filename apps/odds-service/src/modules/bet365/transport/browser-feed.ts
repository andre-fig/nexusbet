import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from "playwright-core";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Esport, Source } from "../types/model.js";
export const origin = "https://www.bet365.bet.br";
export const feedPaths = new Set([
  "/contentdata/othersportsmatchmarketscontentapi/list",
  "/contentdata/othersportsmatchmarketscontentapi/coupon",
  "/contentdata/othersportsmatchbettingcontentapi/coupon",
]);
export function safeFeedUrl(value: string): string {
  const u = new URL(value);
  if (u.origin !== origin || !feedPaths.has(u.pathname))
    throw Error("Not an observed sports feed");
  if (
    [...u.searchParams.keys()].some(
      (k) => !["lid", "zid", "pd", "cid", "cgid", "ctid"].includes(k),
    )
  )
    throw Error(
      "Unrecognized feed query; not persisting potentially sensitive parameters",
    );
  return u.href;
}
export function pageUrl(pd: string): string {
  if (!/^#(?:[A-Z][A-Za-z0-9^.-]*#)+$/.test(pd))
    throw Error("Invalid provider route");
  return origin + "/#/" + pd.slice(1, -1).split("#").join("/") + "/";
}
export interface FeedCapture {
  provider: "bet365";
  esport: Esport;
  capturedAt: string;
  source: Source;
  body: string;
  requestHeaderNames: string[];
  status: number;
}
export { nativeDebugEndpoint } from "../../../shared/browser/endpoint.js";
export class BrowserFeed {
  private constructor(
    readonly browser: Browser,
    readonly context: BrowserContext,
    readonly page: Page,
    readonly owned: boolean,
    private authenticated: boolean | null,
  ) {}
  static async open(endpoint?: string, options: { headless?: boolean } = {}) {
    const browser = endpoint
      ? await chromium.connectOverCDP(endpoint, { timeout: 120000 })
      : await chromium.launch({
          channel: "chrome",
          headless:
            options.headless ??
            !["0", "false"].includes(process.env.HEADLESS ?? "true"),
        });
    const context = endpoint
      ? browser.contexts()[0]
      : await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    if (!context) throw Error("No browser context");
    const page = await context.newPage();
    const client = new BrowserFeed(
      browser,
      context,
      page,
      !endpoint,
      endpoint ? null : false,
    );
    page.on("response", (r) => {
      if (new URL(r.url()).pathname !== "/defaultapi/sports-configuration")
        return;
      void r
        .json()
        .then((c) => {
          if (typeof c.flashvars?.LOGGED_IN === "boolean")
            client.authenticated = c.flashvars.LOGGED_IN;
        })
        .catch(() => {});
    });
    return client;
  }
  async capture(
    esport: Esport,
    pd: string,
    path: string,
    timeout = 25000,
  ): Promise<FeedCapture> {
    if (!feedPaths.has(path)) throw Error("Unsupported feed");
    let resolve!: (r: FeedCapture | PromiseLike<FeedCapture>) => void;
    const response = new Promise<FeedCapture>((r) => {
      resolve = r;
    });
    let selected = false;
    const started = new Set<Request>();
    const onRequest = (r: Request) => {
      started.add(r);
    };
    const listener = (r: import("playwright-core").Response) => {
      const u = new URL(r.url());
      if (
        selected ||
        !started.has(r.request()) ||
        u.origin !== origin ||
        u.pathname !== path ||
        u.searchParams.get("pd") !== pd
      )
        return;
      selected = true;
      const capturedAt = new Date().toISOString();
      resolve(
        (async () => {
          if (r.status() !== 200)
            throw Error(
              `Feed HTTP ${r.status()}; stopping without anti-bot handling`,
            );
          const body = await r.text().catch(() => {
            throw Error(
              "Unable to read feed body; retaining previous snapshot",
            );
          });
          if (!body.startsWith("F|"))
            throw Error("Empty/non-full feed; retaining previous snapshot");
          return {
            provider: "bet365" as const,
            esport,
            capturedAt,
            source: {
              transport: "xhr" as const,
              method: "GET" as const,
              url: safeFeedUrl(r.url()),
              capture: "playwright-response" as const,
              authenticated: this.authenticated,
            },
            body,
            status: r.status(),
            requestHeaderNames: Object.keys(
              await r.request().allHeaders(),
            ).sort(),
          };
        })(),
      );
    };
    this.page.on("request", onRequest);
    this.page.on("response", listener);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const waiting = Promise.race([
        response,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Error(
                  "Frontend did not provide requested feed; no retry or login assumption",
                ),
              ),
            timeout,
          );
        }),
      ]);
      // Attach a rejection handler before navigation to avoid an unhandled timeout.
      void waiting.catch(() => {});
      const url = pageUrl(pd);
      if (this.page.url() === url)
        await this.page.reload({ waitUntil: "domcontentloaded", timeout });
      else
        await this.page.goto(url, { waitUntil: "domcontentloaded", timeout });
      return await waiting;
    } finally {
      clearTimeout(timer);
      this.page.off("response", listener);
      this.page.off("request", onRequest);
    }
  }
  async close() {
    await this.page.close();
    if (this.owned) await this.context.close();
    await this.browser.close();
  }
}
