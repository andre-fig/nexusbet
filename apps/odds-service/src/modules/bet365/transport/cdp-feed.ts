import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright-core";
import { ChromeTab } from "../../../shared/browser/chrome-tab.js";
export { CdpConnection } from "../../../shared/browser/cdp-connection.js";
import {
  origin,
  feedPaths,
  safeFeedUrl,
  pageUrl,
  type FeedCapture,
} from "./browser-feed.js";
import type { Esport } from "../types/model.js";
// Attach only to our own tab. Avoid auto-attachment to the user's unrelated tabs.
const configuredPages = new WeakSet<Page>();
export class CdpFeed extends ChromeTab {
  private warmup: (action: () => Promise<void>) => Promise<void> = (action) =>
    action();
  private currentUrl = "about:blank";
  private authenticated: boolean | null = null;
  private busy = false;
  private managedPage?: Page;
  private warmed = false;
  private reuseTarget = false;
  readonly page = { url: () => this.currentUrl };
  static async open(
    endpoint: string,
    options: {
      reuseTarget?: boolean;
      anonymous?: boolean;
      targetId?: string;
      page?: Page;
      warmup?: (action: () => Promise<void>) => Promise<void>;
    } = {},
  ) {
    const tab = await ChromeTab.open(endpoint, options);
    const feed = new CdpFeed(
      tab.cdp,
      tab.targetId,
      tab.sessionId,
      tab.browserContextId,
      tab.releaseConnection,
    );
    feed.managedPage = options.page;
    feed.reuseTarget = options.reuseTarget ?? false;
    if (options.warmup) feed.warmup = options.warmup;
    if (options.page && !configuredPages.has(options.page)) {
      const consent = options.page.getByText("Somente os essenciais", {
        exact: true,
      });
      try {
        await options.page.addLocatorHandler(consent, async () => {
          await consent.click();
        });
        configuredPages.add(options.page);
      } catch (error) {
        await feed.detach();
        throw error;
      }
    }
    return feed;
  }
  async capture(
    esport: Esport,
    pd: string,
    path: string,
    timeout = 25000,
  ): Promise<FeedCapture> {
    if (this.busy) throw Error("Concurrent navigation is not supported");
    if (!feedPaths.has(path)) throw Error("Unsupported sports feed");
    this.busy = true;
    const requests = new Map<string, string[]>(),
      responses = new Map<
        string,
        { url: string; status: number; at: string }
      >();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settle!: (c: FeedCapture) => void, fail!: (e: Error) => void;
    let selected = false;
    const result = new Promise<FeedCapture>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    const armTimeout = () => {
      timer ??= setTimeout(
        () =>
          fail(
            Error(
              "Frontend did not provide requested feed; retaining previous snapshot",
            ),
          ),
        timeout,
      );
    };
    void result.catch(() => {});
    const onDisconnect = () =>
      fail(Error("Chrome disconnected during capture"));
    const listener = (m: any) => {
      if (m.sessionId !== this.sessionId) return;
      const p = m.params;
      if (m.method === "Network.requestWillBeSent") {
        const u = new URL(p.request.url);
        if (
          u.pathname === path ||
          u.pathname === "/defaultapi/sports-configuration"
        )
          requests.set(p.requestId, Object.keys(p.request.headers));
      }
      if (
        m.method === "Network.responseReceived" &&
        requests.has(p.requestId)
      ) {
        const u = new URL(p.response.url);
        if (
          u.origin === origin &&
          (u.pathname === "/defaultapi/sports-configuration" ||
            (u.pathname === path && u.searchParams.get("pd") === pd))
        )
          responses.set(p.requestId, {
            url: u.href,
            status: p.response.status,
            at: new Date().toISOString(),
          });
      }
      if (m.method === "Network.loadingFailed" && responses.has(p.requestId))
        fail(Error("Feed network request failed"));
      if (m.method !== "Network.loadingFinished" || !responses.has(p.requestId))
        return;
      const response = responses.get(p.requestId)!;
      responses.delete(p.requestId);
      const config =
        new URL(response.url).pathname === "/defaultapi/sports-configuration";
      if (!config && selected) return;
      if (!config) selected = true;
      void (async () => {
        try {
          if (response.status !== 200)
            throw Error(`Feed HTTP ${response.status}; no automatic retry`);
          const raw = await this.cdp.send(
            "Network.getResponseBody",
            { requestId: p.requestId },
            this.sessionId,
          );
          const body = raw.base64Encoded
            ? Buffer.from(raw.body, "base64").toString("utf8")
            : raw.body;
          if (config) {
            const loggedIn = JSON.parse(body).flashvars?.LOGGED_IN;
            if (typeof loggedIn === "boolean") this.authenticated = loggedIn;
            return;
          }
          if (!body.startsWith("F|"))
            throw Error("Empty/non-full feed; retaining previous snapshot");
          settle({
            provider: "bet365",
            esport,
            capturedAt: response.at,
            source: {
              transport: "xhr",
              method: "GET",
              url: safeFeedUrl(response.url),
              capture: "chrome-cdp-response",
              authenticated: this.authenticated,
            },
            body,
            requestHeaderNames: (requests.get(p.requestId) || []).sort(),
            status: response.status,
          });
        } catch (e) {
          if (!config) fail(e as Error);
        }
      })();
    };
    this.cdp.on("protocol", listener);
    this.cdp.on("disconnected", onDisconnect);
    try {
      const url = pageUrl(pd);
      if (
        !this.reuseTarget &&
        !this.managedPage &&
        this.currentUrl !== "about:blank"
      ) {
        const oldTarget = this.targetId;
        const created = await this.cdp.send("Target.createTarget", {
          url: "about:blank",
          ...(this.browserContextId
            ? { browserContextId: this.browserContextId }
            : {}),
        });
        this.targetId = created.targetId;
        this.sessionId = (
          await this.cdp.send("Target.attachToTarget", {
            targetId: this.targetId,
            flatten: true,
          })
        ).sessionId;
        await this.cdp.send("Page.enable", {}, this.sessionId);
        await this.cdp.send("Network.enable", {}, this.sessionId);
        await this.cdp.send("Target.closeTarget", { targetId: oldTarget });
      }
      if (this.managedPage) {
        if (!this.warmed) {
          await this.warmup(async () => {
            armTimeout();
            const response = await this.managedPage!.goto(origin + "/", {
              waitUntil: "domcontentloaded",
              timeout,
            });
            if (response && response.status() >= 400)
              throw Error(`Homepage HTTP ${response.status()}`);
            await this.managedPage!.getByText(/^e-?sports$/i)
              .first()
              .click({ timeout });
            this.warmed = true;
          });
        }
        armTimeout();
        // PD is a frontend route advertised by the accepted listing/coupon, never an API URL.
        if (this.managedPage.url() === url)
          await this.managedPage.reload({
            waitUntil: "domcontentloaded",
            timeout,
          });
        else
          await this.managedPage.goto(url, {
            waitUntil: "domcontentloaded",
            timeout,
          });
      } else {
        if (this.reuseTarget && !this.warmed) {
          await this.warmup(async () => {
            await this.cdp.send(
              "Page.navigate",
              { url: origin + "/" },
              this.sessionId,
            );
            const until = Date.now() + timeout;
            let clicked = false;
            while (Date.now() < until && !clicked) {
              const state = await this.cdp.send(
                "Runtime.evaluate",
                {
                  expression: `(()=>{const visible=e=>!!(e.offsetWidth||e.offsetHeight);const consent=[...document.querySelectorAll('button')].find(e=>visible(e)&&e.textContent.trim()==='Somente os essenciais');if(consent){consent.click();return false}const es=[...document.querySelectorAll('a,button,span,div')].filter(e=>visible(e)&&/^e-?sports$/i.test(e.textContent.trim()));const e=es.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];if(!e)return false;e.click();return true})()`,
                  returnByValue: true,
                },
                this.sessionId,
              );
              clicked = state.result?.value === true;
              if (!clicked) await delay(200);
            }
            if (!clicked) throw Error("Bet365 eSports navigation unavailable");
            this.warmed = true;
          });
        }
        armTimeout();
        const navigation = await this.cdp.send(
          "Page.navigate",
          { url },
          this.sessionId,
        );
        if (navigation.errorText) throw Error("Page navigation failed");
      }
      this.currentUrl = url;
      return await result;
    } finally {
      clearTimeout(timer);
      this.cdp.off("protocol", listener);
      this.cdp.off("disconnected", onDisconnect);
      this.busy = false;
    }
  }
}
