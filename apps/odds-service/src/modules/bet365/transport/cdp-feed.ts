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
export class CdpFeed extends ChromeTab {
  private currentUrl = "about:blank";
  private authenticated: boolean | null = null;
  private busy = false;
  readonly page = { url: () => this.currentUrl };
  static async open(endpoint: string, options: { anonymous?: boolean } = {}) {
    const tab = await ChromeTab.open(endpoint, options);
    return new CdpFeed(
      tab.cdp,
      tab.targetId,
      tab.sessionId,
      tab.browserContextId,
      tab.releaseConnection,
    );
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
      timer = setTimeout(
        () =>
          reject(
            Error(
              "Frontend did not provide requested feed; retaining previous snapshot",
            ),
          ),
        timeout,
      );
    });
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
      if (this.currentUrl !== "about:blank") {
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
      const navigation = await this.cdp.send(
        "Page.navigate",
        { url },
        this.sessionId,
      );
      if (navigation.errorText) throw Error("Page navigation failed");
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
