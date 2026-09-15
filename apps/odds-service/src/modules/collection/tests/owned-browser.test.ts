import { ChromeTab } from "../../../shared/browser/chrome-tab.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { browserConfiguration } from "../../../config/browser.configuration.js";
import {
  OwnedBrowser,
  launchOptions,
} from "../../../shared/browser/owned-browser.js";
import {
  BrowserEvidence,
  evidenceUrl,
} from "../../../shared/browser/browser-evidence.js";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

test("browser config selects mode/locale/screen and rejects unsafe provider paths or invalid settings", () => {
  const keys = [
    "BROWSER_MODE",
    "HEADLESS",
    "CHROME_CHANNEL",
    "BROWSER_PERSISTENT",
    "BROWSER_VIEWPORT_WIDTH",
    "BROWSER_TIMEZONE",
    "BROWSER_SHARED_CONTEXT",
    "BROWSER_SHARED_INSTANCE",
    "PROVIDER_MAIN_TAB",
    "PROVIDER_DETAIL_TAB_MAX",
  ];
  const old = keys.map((k) => process.env[k]);
  try {
    keys.forEach((k) => delete process.env[k]);
    let c = browserConfiguration();
    assert.equal(c.mode, "headed");
    assert.equal(c.locale, "pt-BR");
    assert.equal(c.persistent, true);
    const options = launchOptions(c);
    assert.equal(options.serviceWorkers, "allow");
    assert.deepEqual(options.screen, options.viewport);
    assert.ok(!options.args.includes("--headless=new"));
    assert.equal(options.headless, false);
    assert.equal("userAgent" in options, false);
    assert.equal("ignoreDefaultArgs" in options, false);
    process.env.BROWSER_MODE = "headed";
    c = browserConfiguration();
    assert.equal(launchOptions(c).headless, false);
    assert.ok(!launchOptions(c).args.includes("--headless=new"));
    assert.notEqual(
      new OwnedBrowser(c, "bet365").profilePath,
      new OwnedBrowser(c, "betano").profilePath,
    );
    assert.throws(() => new OwnedBrowser(c, "../personal"));
    process.env.BROWSER_MODE = "stealth";
    assert.throws(browserConfiguration, /Invalid BROWSER_MODE/);
    process.env.BROWSER_MODE = "headless";
    process.env.CHROME_CHANNEL = "chromium";
    assert.throws(browserConfiguration, /Stable/);
    process.env.CHROME_CHANNEL = "chrome";
    process.env.BROWSER_VIEWPORT_WIDTH = "NaN";
    assert.throws(browserConfiguration, /WIDTH/);
    process.env.BROWSER_SHARED_CONTEXT = "false";
    assert.throws(browserConfiguration, /BROWSER_SHARED_CONTEXT/);
    process.env.BROWSER_SHARED_CONTEXT = "true";
    process.env.PROVIDER_DETAIL_TAB_MAX = "2";
    assert.throws(browserConfiguration, /DETAIL_TAB_MAX/);
  } finally {
    keys.forEach((k, i) => {
      if (old[i] === undefined) delete process.env[k];
      else process.env[k] = old[i];
    });
  }
});

test("concurrent opens reuse context; reload/page/restart preserve profile; failed launch never deletes persistent storage", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "odds-owned-test-"));
  let failLaunch = false;
  let launches = 0,
    closes = 0,
    reloads = 0;
  const page = {
    reload: async () => {
      reloads++;
    },
    close: async () => {},
  } as unknown as Page;
  t.mock.method(chromium, "launchPersistentContext", async () => {
    if (failLaunch) throw Error("launch failed");
    launches++;
    return {
      pages: () => [page],
      newPage: async () => page,
      on: () => {},
      close: async () => {
        closes++;
      },
    } as unknown as BrowserContext;
  });
  const c = { ...browserConfiguration(), profileDir: root, persistent: true };
  const browser = new OwnedBrowser(c, "bet365");
  try {
    const [a, b] = await Promise.all([browser.open(), browser.open()]);
    assert.equal(a, b);
    assert.equal(launches, 1);
    await writeFile(join(browser.profilePath, "technical-marker"), "preserved");
    await browser.recover("reload");
    await browser.recover("page");
    assert.equal(reloads, 1);
    assert.equal(launches, 1);
    await Promise.all([browser.close(), browser.close()]);
    assert.equal(closes, 1);
    await browser.open();
    assert.equal(launches, 2);
    assert.equal(
      await readFile(join(browser.profilePath, "technical-marker"), "utf8"),
      "preserved",
    );
    await browser.close();
    failLaunch = true;
    await assert.rejects(browser.open());
    assert.equal(
      await readFile(join(browser.profilePath, "technical-marker"), "utf8"),
      "preserved",
    );
  } finally {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("diagnostic URL sanitizer drops credentials/query/hash values", () => {
  const safe = evidenceUrl(
    "https://login:password@example.test/api/feed?token=SECRET&event=123#SECRET",
  );
  assert.equal(
    safe,
    "https://example.test/api/feed?token=[redacted]&event=[redacted]#[redacted]",
  );
  assert.ok(!safe.includes("SECRET"));
  assert.equal(evidenceUrl("data:text/plain,password"), "data:");
});

test(
  "real Chrome preserves technical storage across restart; five cycles reuse context, SW/cache/WebSocket work",
  { skip: process.env.BROWSER_TESTS !== "1" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "odds-persistent-real-"));
    const server = createServer((req, res) => {
      if (req.url === "/sw.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(
          "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(new URL(e.request.url).pathname==='/sw-value')e.respondWith(new Response('service-worker-ok'))})",
        );
      } else {
        res.writeHead(200, {
          "content-type": "text/html",
          "set-cookie": "technical=local-test; Max-Age=3600; Path=/",
        });
        res.end("<!doctype html><title>Local browser validation</title>");
      }
    });
    const ws = new WebSocketServer({ server });
    ws.on("connection", (client) => client.send("socket-ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Missing server port");
    const url = `http://127.0.0.1:${address.port}`;
    const browser = new OwnedBrowser(
      {
        ...browserConfiguration(),
        mode: process.env.DISPLAY ? "headed" : "headless",
        profileDir: root,
        persistent: true,
      },
      "betano",
    );
    try {
      const ctx = await browser.open();
      const evidence = new BrowserEvidence(ctx);
      let page = ctx.pages()[0];
      for (let cycle = 0; cycle < 5; cycle++) {
        assert.equal(await browser.open(), ctx);
        assert.equal(ctx.pages().length, 1);
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.evaluate(async () => {
          localStorage.setItem("technical", "persisted");
          await new Promise<void>((resolve, reject) => {
            const r = indexedDB.open("technical-db", 1);
            r.onupgradeneeded = () => r.result.createObjectStore("data");
            r.onsuccess = () => {
              r.result.close();
              resolve();
            };
            r.onerror = () => reject(r.error);
          });
          const cache = await caches.open("technical-cache");
          await cache.put("/value", new Response("cached"));
          await navigator.serviceWorker.register("/sw.js");
          await navigator.serviceWorker.ready;
        });
      }
      await page.waitForFunction(
        () => navigator.serviceWorker.controller !== null,
      );
      assert.equal(
        await page.evaluate(
          async () => await (await fetch("/sw-value")).text(),
        ),
        "service-worker-ok",
      );
      assert.equal(
        await page.evaluate(
          () =>
            new Promise<string>((resolve, reject) => {
              const ws = new WebSocket(location.origin.replace("http:", "ws:"));
              ws.onmessage = (e) => {
                resolve(e.data);
                ws.close();
              };
              ws.onerror = () => reject(Error("socket failed"));
            }),
        ),
        "socket-ok",
      );
      const info = await browser.attachInfo();
      const tab = await ChromeTab.open(info.endpoint, {
        targetId: info.targetId,
      });
      try {
        const result = await tab.cdp.send(
          "Runtime.evaluate",
          {
            expression: "localStorage.getItem('technical')",
            returnByValue: true,
          },
          tab.sessionId,
        );
        assert.equal(result.result.value, "persisted");
        assert.equal(tab.browserContextId, undefined);
      } finally {
        tab.releaseConnection();
      }
      const meta = await evidence.snapshot(page);
      assert.ok(
        meta.executablePath?.includes("Chrome") ||
          meta.executablePath?.includes("chrome"),
      );
      assert.equal(
        meta.commandLine?.includes("--headless=new"),
        !process.env.DISPLAY,
      );
      assert.equal(meta.environment?.language, "pt-BR");
      await browser.close();
      const restored = await browser.open();
      assert.notEqual(restored, ctx);
      // Read persisted cookie before navigation can create a fresh one.
      assert.ok(
        (await restored.cookies(url)).some((c) => c.name === "technical"),
      );
      page = restored.pages()[0];
      await page.goto(url);
      const state = await page.evaluate(async () => ({
        local: localStorage.getItem("technical"),
        db: (await indexedDB.databases()).map((d) => d.name),
        cache: await (
          await (await caches.open("technical-cache")).match("/value")
        )?.text(),
        sw: (await navigator.serviceWorker.getRegistrations()).length,
      }));
      assert.equal(state.local, "persisted");
      assert.ok(state.db.includes("technical-db"));
      assert.equal(state.cache, "cached");
      assert.ok(state.sw > 0);
    } finally {
      await browser.close();
      ws.close();
      await new Promise<void>((r) => server.close(() => r()));
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("Betano discovery reuses its browser between cycles and closes it only at lifecycle end", async () => {
  const { BetanoCollector } = await import("../../betano/betano.collector.js");
  const { AppConfiguration, configuration } =
    await import("../../../config/configuration.js");
  const { ConfigService } = await import("@nestjs/config");
  const root = await mkdtemp(join(tmpdir(), "odds-betano-reuse-"));
  let opened = 0,
    closed = 0,
    started = 0;
  const browser = {
    signal: undefined as AbortSignal | undefined,
    start: async () => {
      started++;
    },
    clickLink: async () => {},
    capture: async (action: () => Promise<void>) => {
      await action();
      return {
        data: { regionGroups: [] },
        capturedAt: new Date().toISOString(),
      };
    },
    close: async () => {
      closed++;
    },
  };
  const factory = {
    run: async <T>(action: () => Promise<T>) => action(),
    open: async () => {
      opened++;
      return browser;
    },
  };
  const config = new AppConfiguration(
    new ConfigService({
      settings: {
        ...configuration().settings,
        betanoCaptureDir: join(root, "captures"),
        betanoInboxDir: join(root, "inbox"),
      },
    }),
  );
  const collector = new BetanoCollector(
    factory as unknown as ConstructorParameters<typeof BetanoCollector>[0],
    config,
  );
  try {
    // Empty modality selection isolates discovery lifecycle from parser tests (covered separately).
    await collector.collectEvents({ esports: [] });
    await collector.collectEvents({ esports: [] });
    assert.equal(opened, 1);
    assert.equal(started, 2);
    assert.equal(closed, 0);
  } finally {
    await collector.close();
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(closed, 1);
});

test("comparison identifies first homepage divergence without blaming headless when both modes fail", async () => {
  const { compareBrowserEvidence } =
    await import("../../../shared/browser/browser-comparison.js");
  const evidence = (status: number) => ({
    events: [
      {
        kind: "response",
        resource: "document",
        url: "https://www.bet365.bet.br/",
        status,
      },
    ],
  });
  assert.equal(
    compareBrowserEvidence(evidence(200), evidence(403)).firstDifference,
    "homepage_http_status",
  );
  const both = compareBrowserEvidence(evidence(403), evidence(403));
  assert.equal(both.firstDifference, null);
  assert.equal(both.sharedHomepageFailure, true);
});
