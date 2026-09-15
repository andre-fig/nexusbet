import type { Page } from "playwright-core";
import { ChromeTab } from "../../../shared/browser/chrome-tab.js";
import { nativeDebugEndpoint } from "../../../shared/browser/endpoint.js";
import { setTimeout as delay } from "node:timers/promises";
import { origin, safeUrl, type BetanoCapture } from "../parsers/feed.parser.js";
// The client attaches only to its owned target in existing Chrome. No HTTP replay or token construction.
const configuredPages = new WeakSet<Page>();
export class BetanoBrowser {
  private warmed = false;
  private warmup: (action: () => Promise<void>) => Promise<void> = (action) =>
    action();
  signal?: AbortSignal;
  private constructor(
    readonly owner: ChromeTab,
    readonly page?: Page,
  ) {}
  static async open(
    endpoint?: string,
    options: {
      targetId?: string;
      page?: Page;
      warmup?: (action: () => Promise<void>) => Promise<void>;
    } = {},
  ) {
    if (options.page && !configuredPages.has(options.page)) {
      configuredPages.add(options.page);
      const page = options.page;
      const cookies = page.getByRole("button", {
        name: "Rejeitar Todos",
        exact: true,
      });
      await page.addLocatorHandler(cookies, async () => {
        await cookies.click();
      });
      const age = page.locator('[data-qa="age-verification-modal-ok-button"]');
      // The adult user explicitly authorized this confirmation in this session.
      await page.addLocatorHandler(age, async () => {
        await age.click();
      });
    }
    const browser = new BetanoBrowser(
      await ChromeTab.open(
        endpoint || process.env.CDP_URL || (await nativeDebugEndpoint()),
        { anonymous: !options.targetId, targetId: options.targetId },
      ),
      options.page,
    );
    if (options.warmup) browser.warmup = options.warmup;
    return browser;
  }
  async evaluate(expression: string) {
    this.signal?.throwIfAborted();
    return (
      await this.owner.cdp.send(
        "Runtime.evaluate",
        { expression, returnByValue: true },
        this.owner.sessionId,
      )
    ).result?.value;
  }
  async confirmAge() {
    await this.evaluate(
      `(()=>{if(document.body?.innerText.includes('VOCÊ TEM MAIS DE 18 ANOS?')){document.querySelector('[data-qa="age-verification-modal-ok-button"]')?.click()}})()`,
    );
  }
  async clickLink(path: string) {
    await this.confirmAge();
    if (
      !/^\/(sport\/esports\/|odds\/[^/]+\/\d+\/)/.test(path) ||
      path.includes("criar-aposta")
    )
      throw Error("Not an allowed navigation");
    if (this.page) {
      await this.page
        .locator(`a[href=${JSON.stringify(path)}]`)
        .first()
        .click({ timeout: 25000 });
      return;
    }
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      ok = await this.evaluate(
        `(()=>{const a=Array.from(document.querySelectorAll('a[href]')).find(a=>a.getAttribute('href')===${JSON.stringify(path)}||a.href===${JSON.stringify(origin + path)});if(!a)return false;a.click();return true})()`,
      );
      if (!ok) await delay(100);
    }
    if (!ok) throw Error("Navigation link unavailable: " + path);
  }
  async clickText(name: string) {
    await this.confirmAge();
    if (this.page) {
      await this.page
        .getByText(name, { exact: true })
        .first()
        .click({ timeout: 25000 });
      return;
    }
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      ok = await this.evaluate(
        `(()=>{const e=Array.from(document.querySelectorAll('a,button,span,div')).find(e=>e.children.length===0&&e.textContent.trim()===${JSON.stringify(name)}&&!e.closest('.selections__selection,[aria-label^="Bet on"]'));if(!e)return false;e.click();return true})()`,
      );
      if (!ok) await delay(100);
    }
    if (!ok) throw Error("Navigation label unavailable: " + name);
  }
  async start() {
    if (this.warmed) return this.startNavigation();
    return this.warmup(async () => {
      await this.startNavigation();
      this.warmed = true;
    });
  }
  private async startNavigation() {
    if (this.page) {
      const response = await this.page.goto(origin + "/", {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });
      if (response && response.status() >= 400)
        throw Error(`Homepage HTTP ${response.status()}`);
      await this.confirmAge();
      await this.page
        .locator('a[href="/sport/esports/"]')
        .first()
        .waitFor({ state: "visible", timeout: 25000 });
      return;
    }
    await this.owner.cdp.send(
      "Page.navigate",
      { url: origin + "/" },
      this.owner.sessionId,
    );
    const end = Date.now() + 25000;
    while (Date.now() < end) {
      // The user explicitly authorized the age confirmation. No other confirmation is automated.
      await this.confirmAge();
      const ready = await this.evaluate(
        `!!document.querySelector('a[href="/sport/esports/"]')`,
      );
      if (ready) return;
      await delay(250);
    }
    throw Error("Betano homepage unavailable; no login or anti-bot fallback");
  }
  async capture(
    action: () => Promise<void>,
    accept: (u: URL) => boolean,
    timeout = 25000,
  ): Promise<BetanoCapture> {
    const { cdp, sessionId } = this.owner;
    const requests = new Map<
      string,
      { url: string; headers: string[]; method: string }
    >();
    const responses = new Map<string, any>();
    let timer: ReturnType<typeof setTimeout>;
    let settle!: (c: BetanoCapture) => void, fail!: (e: Error) => void;
    let chosen = false;
    const result = new Promise<BetanoCapture>((r, j) => {
      settle = r;
      fail = j;
      timer = setTimeout(
        () =>
          j(Error("No fresh Betano sports response; previous state preserved")),
        timeout,
      );
    });
    void result.catch(() => {});
    const listener = (m: any) => {
      if (m.sessionId !== sessionId) return;
      const p = m.params;
      if (m.method === "Network.requestWillBeSent") {
        const u = new URL(p.request.url);
        if (u.origin === origin && accept(u))
          requests.set(p.requestId, {
            url: u.href,
            headers: Object.keys(p.request.headers).sort(),
            method: p.request.method,
          });
      }
      if (m.method === "Network.responseReceived" && requests.has(p.requestId))
        responses.set(p.requestId, {
          status: p.response.status,
          at: new Date().toISOString(),
        });
      if (m.method === "Network.loadingFailed" && responses.has(p.requestId))
        fail(Error("Betano request failed"));
      if (
        m.method !== "Network.loadingFinished" ||
        !responses.has(p.requestId) ||
        chosen
      )
        return;
      chosen = true;
      const meta = responses.get(p.requestId),
        req = requests.get(p.requestId)!;
      void (async () => {
        try {
          if (meta.status !== 200 || req.method !== "GET")
            throw Error("Betano HTTP " + meta.status + "; no retry");
          const response = await cdp.send(
            "Network.getResponseBody",
            { requestId: p.requestId },
            sessionId,
          );
          const body = JSON.parse(
            response.base64Encoded
              ? Buffer.from(response.body, "base64").toString()
              : response.body,
          );
          if (!body.data || typeof body.data !== "object")
            throw Error("Missing Betano structured data");
          const data = { ...body.data };
          delete data.seoComponent;
          delete data.seoTranslations;
          const cookies = await cdp.send(
            "Network.getCookies",
            { urls: [origin] },
            sessionId,
          );
          settle({
            provider: "betano",
            capturedAt: meta.at,
            status: meta.status,
            source: {
              transport: "xhr",
              method: "GET",
              capture: "chrome-cdp-response",
              authenticated: false,
              url: safeUrl(req.url),
            },
            data,
            requestHeaderNames: req.headers,
            cookieNames: cookies.cookies.map((c: any) => c.name).sort(),
          });
        } catch (e) {
          fail(e as Error);
        }
      })();
    };
    cdp.on("protocol", listener);
    try {
      await action();
      return await result;
    } finally {
      clearTimeout(timer!);
      cdp.off("protocol", listener);
    }
  }
  async evidence() {
    await this.confirmAge();
    await delay(300);
    const state = await this.evaluate(
      `JSON.stringify({url:location.href,text:document.body.innerText,loginVisible:Array.from(document.querySelectorAll('a,button')).some(e=>/^(ENTRAR|INICIAR SESSÃO)$/.test(e.textContent.trim()))})`,
    );
    const screenshot = await this.owner.cdp.send(
      "Page.captureScreenshot",
      { format: "png" },
      this.owner.sessionId,
    );
    return {
      state: JSON.parse(state),
      png: Buffer.from(screenshot.data, "base64"),
    };
  }
  close() {
    return this.owner.close();
  }
}
