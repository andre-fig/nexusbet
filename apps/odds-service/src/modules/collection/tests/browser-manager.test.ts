import { BetanoBrowser } from "../../betano/transport/betano-browser.js";
import { CdpFeed } from "../../bet365/transport/cdp-feed.js";
import "reflect-metadata";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { ConfigService } from "@nestjs/config";
import {
  AppConfiguration,
  configuration,
} from "../../../config/configuration.js";
import { BrowserManagerService } from "../../../shared/browser/browser-manager.service.js";
import { openManagedFeed } from "../../../shared/browser/managed-feed.js";
import { ChromeTab } from "../../../shared/browser/chrome-tab.js";
import { createServer } from "node:http";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
class FakePage extends EventEmitter {
  closed = false;
  constructor(private readonly ctx: FakeContext) {
    super();
  }
  context() {
    return this.ctx as unknown as BrowserContext;
  }
  isClosed() {
    return this.closed;
  }
  url() {
    return "about:blank";
  }
  async close() {
    if (!this.closed) {
      this.closed = true;
      this.emit("close");
    }
  }
}
class FakeContext extends EventEmitter {
  all: FakePage[] = [new FakePage(this)];
  closeCount = 0;
  pages() {
    return this.all.filter((p) => !p.closed) as unknown as Page[];
  }
  async newPage() {
    const p = new FakePage(this);
    this.all.push(p);
    this.emit("page", p);
    return p as unknown as Page;
  }
  async close() {
    this.closeCount++;
    await Promise.all(this.all.map((p) => p.close()));
    this.emit("close");
  }
}
async function harness(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "odds-shared-test-"));
  const contexts: FakeContext[] = [];
  const launch = t.mock.method(
    chromium,
    "launchPersistentContext",
    async (path: string) => {
      assert.equal(path, root);
      const ctx = new FakeContext();
      contexts.push(ctx);
      return ctx as unknown as BrowserContext;
    },
  );
  const base = configuration().settings;
  const manager = new BrowserManagerService(
    new AppConfiguration(
      new ConfigService({
        settings: {
          ...base,
          browser: {
            ...base.browser,
            profileDir: root,
            mode: "headed",
            persistent: true,
          },
        },
      }),
    ),
  );
  t.after(async () => {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  });
  return { manager, root, contexts, launch };
}

test("one Chrome/context and one stable main tab per provider, including future provider keys", async (t) => {
  const { manager: m, contexts, launch } = await harness(t);
  const names = ["bet365", "betano", "superbet", "blaze", "estrelabet"];
  const pages = await Promise.all(names.map((n) => m.getPage(n)));
  assert.equal(new Set(pages).size, 5);
  for (let cycle = 0; cycle < 5; cycle++)
    for (const [i, name] of names.entries())
      assert.equal(await m.getPage(name), pages[i]);
  assert.equal(launch.mock.callCount(), 1);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].pages().length, 5);
  assert.equal(m.health().contexts, 1);
  assert.equal(contexts[0].listenerCount("request"), 1);
});

test("provider locks reject duplicate jobs, distinct tabs run in parallel, failure does not affect peer", async (t) => {
  const { manager: m } = await harness(t);
  const a = deferred(),
    b = deferred(),
    entered = deferred();
  let running = 0;
  const op = (gate: ReturnType<typeof deferred>) => async () => {
    if (++running === 2) entered.resolve();
    await gate.promise;
  };
  const first = m.runExclusive("bet365", op(a));
  const second = m.runExclusive("betano", op(b));
  await entered.promise;
  await assert.rejects(
    m.runExclusive("bet365", async () => {}),
    /busy/,
  );
  a.resolve();
  b.resolve();
  await Promise.all([first, second]);
  const peer = await m.getPage("betano");
  await assert.rejects(
    m.runExclusive("bet365", async () => {
      throw Error("HTTP 403");
    }),
  );
  assert.equal(m.health().providers.bet365.failureCount, 1);
  assert.equal(await m.getPage("betano"), peer);
  await m.runExclusive("bet365", async () => {});
  assert.equal(m.health().providers.bet365.failureCount, 0);
});

test("page crash replaces just that page; browser/context crash rebuilds one shared instance without removing profile", async (t) => {
  const { manager: m, contexts, launch, root } = await harness(t);
  const a = await m.getPage("bet365"),
    b = await m.getPage("betano");
  (a as unknown as FakePage).emit("crash");
  const newA = await m.getPage("bet365");
  assert.notEqual(newA, a);
  assert.equal(await m.getPage("betano"), b);
  assert.equal(contexts[0].pages().length, 2);
  assert.equal(launch.mock.callCount(), 1);
  await writeFile(join(root, "technical-marker"), "preserved");
  await contexts[0].close();
  const [x, y] = await Promise.all([m.getPage("bet365"), m.getPage("betano")]);
  assert.notEqual(x, newA);
  assert.notEqual(y, b);
  assert.equal(x.context(), y.context());
  assert.equal(launch.mock.callCount(), 2);
  assert.equal(contexts[1].pages().length, 2);
  assert.equal(
    await readFile(join(root, "technical-marker"), "utf8"),
    "preserved",
  );
});

test("abort closes only the active target before unlocking, keeping peer and browser alive", async (t) => {
  const { manager: m, launch } = await harness(t);
  const a = await m.getPage("bet365"),
    b = await m.getPage("betano");
  const abort = new AbortController();
  await assert.rejects(
    m.runExclusive(
      "bet365",
      async () => {
        abort.abort();
        throw Error("aborted");
      },
      abort.signal,
    ),
  );
  assert.equal(a.isClosed(), true);
  assert.equal(b.isClosed(), false);
  assert.equal(m.health().providers.bet365.busy, false);
  assert.notEqual(await m.getPage("bet365"), a);
  assert.equal(launch.mock.callCount(), 1);
});

test("optional detail tabs are bounded and closed after failure and success", async (t) => {
  const { manager: m, contexts } = await harness(t);
  const main = await m.getPage("bet365");
  await assert.rejects(
    m.withDetailPage("bet365", async () => {}),
    /unavailable/,
  );
  for (let cycle = 0; cycle < 5; cycle++) {
    await m.runExclusive("bet365", async () => {
      const gate = deferred(),
        entered = deferred();
      const detail = m.withDetailPage("bet365", async () => {
        entered.resolve();
        await gate.promise;
        throw Error("detail failed");
      });
      await entered.promise;
      assert.equal(contexts[0].pages().length, 2);
      await assert.rejects(
        m.withDetailPage("bet365", async () => {}),
        /busy/,
      );
      gate.resolve();
      await assert.rejects(detail);
      await m.withDetailPage("bet365", async (p) => assert.notEqual(p, main));
    });
    assert.equal(contexts[0].pages().length, 1);
  }
});

test("warmup is serialized while shutdown waits for an active job and rejects new jobs", async (t) => {
  const { manager: m, contexts } = await harness(t);
  const gate = deferred(),
    entered = deferred();
  const order: number[] = [];
  const first = m.warmup(async () => {
    order.push(1);
    entered.resolve();
    await gate.promise;
    order.push(2);
  });
  const second = m.warmup(async () => {
    order.push(3);
  });
  await entered.promise;
  assert.deepEqual(order, [1]);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, [1, 2, 3]);
  const finish = deferred(),
    active = deferred();
  const job = m.runExclusive("bet365", async () => {
    active.resolve();
    await finish.promise;
  });
  await active.promise;
  const closing = m.close();
  await assert.rejects(
    m.runExclusive("betano", async () => {}),
    /stopping/,
  );
  assert.equal(contexts[0].closeCount, 0);
  finish.resolve();
  await job;
  await closing;
  assert.equal(contexts[0].closeCount, 1);
  assert.equal(contexts[0].pages().length, 0);
  await m.close();
  assert.equal(contexts[0].closeCount, 1);
});

test("reopening provider adapters does not register duplicate page UI handlers", async (t) => {
  let registered = 0;
  const locator = { click: async () => {} };
  const page = () =>
    ({
      getByText: () => locator,
      getByRole: () => locator,
      locator: () => locator,
      addLocatorHandler: async () => {
        registered++;
      },
    }) as unknown as Page;
  const a = page(),
    b = page();
  t.mock.method(
    ChromeTab,
    "open",
    async () =>
      ({
        cdp: { send: async () => ({}) },
        targetId: "fixed",
        sessionId: "owned",
        releaseConnection: () => {},
      }) as unknown as ChromeTab,
  );
  for (let cycle = 0; cycle < 5; cycle++) {
    const first = await CdpFeed.open("unused", { targetId: "fixed", page: a });
    const second = await BetanoBrowser.open("unused", {
      targetId: "fixed",
      page: b,
    });
    await first.detach();
    assert.ok(second);
  }
  assert.equal(registered, 3); // One Bet365 consent handler, two Betano UI handlers.
});

test(
  "real shared headed Chrome: five local cycles reuse targets, CDP detach does not close peers or accumulate listeners, storage survives restart",
  { skip: process.env.BROWSER_TESTS !== "1" || !process.env.DISPLAY },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "odds-shared-real-"));
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>Shared browser local test</title>");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw Error("Missing port");
    const base = configuration().settings;
    const cfg = new AppConfiguration(
      new ConfigService({
        settings: {
          ...base,
          browser: {
            ...base.browser,
            mode: "headed",
            profileDir: root,
            evidenceDir: join(root, "evidence"),
            persistent: true,
          },
        },
      }),
    );
    const m = new BrowserManagerService(cfg);
    try {
      const a = await m.getPage("bet365"),
        b = await m.getPage("betano");
      assert.equal(a.context(), b.context());
      const requestListeners = (
        a.context() as unknown as EventEmitter
      ).listenerCount("request");
      for (let i = 0; i < 5; i++) {
        await Promise.all(
          ["bet365", "betano"].map((provider) =>
            m.runExclusive(provider, async () => {
              const page = await m.getPage(provider);
              await page.goto(`http://127.0.0.1:${addr.port}/${provider}`);
              const lease = await openManagedFeed(
                m,
                provider,
                (endpoint, targetId) => ChromeTab.open(endpoint, { targetId }),
                (feed) => feed.detach(),
              );
              await page.evaluate(() =>
                localStorage.setItem("technical", "kept"),
              );
              assert.equal(lease.cdp.listenerCount("protocol"), 0);
              await lease.close();
              assert.equal(page.isClosed(), false);
            }),
          ),
        );
        assert.equal(await m.getPage("bet365"), a);
        assert.equal(await m.getPage("betano"), b);
        assert.equal(m.health().tabs, 2);
        assert.equal(
          (a.context() as unknown as EventEmitter).listenerCount("request"),
          requestListeners,
        );
      }
      // No external traffic: exercise the real feed listener against an intercepted fixture SPA.
      const path = "/contentdata/othersportsmatchmarketscontentapi/list";
      let rejectFeed = false;
      await a.context().route("**/*", async (route) => {
        if (new URL(route.request().url()).pathname === path) {
          await route.fulfill({
            status: rejectFeed ? 503 : 200,
            body: "F|EV;ID=local;|",
            contentType: "text/plain",
          });
        } else {
          await route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><button>E-Sports</button><script>
            function feed(){if(location.hash.startsWith('#/AC/'))fetch('${path}?pd='+encodeURIComponent('#'+location.hash.slice(2,-1).split('/').join('#')+'#'))}
            addEventListener('hashchange',feed);feed();
          </script>`,
          });
        }
      });
      for (let i = 0; i < 5; i++) {
        await m.runExclusive("bet365", async () => {
          const lease = await openManagedFeed(
            m,
            "bet365",
            (endpoint, targetId, page) =>
              CdpFeed.open(endpoint, { targetId, page }),
            (feed) => feed.detach(),
          );
          try {
            const count = lease.cdp.listenerCount("protocol");
            const disconnectedCount = lease.cdp.listenerCount("disconnected");
            const capture = await lease.capture(
              "cs2",
              "#AC#B151#C1#D50#E2#F163#",
              path,
              5000,
            );
            assert.equal(capture.body, "F|EV;ID=local;|");
            assert.equal(lease.cdp.listenerCount("protocol"), count);
            assert.equal(
              lease.cdp.listenerCount("disconnected"),
              disconnectedCount,
            );
            rejectFeed = true;
            await assert.rejects(
              lease.capture("cs2", "#AC#B151#C1#D50#E2#F163#", path, 5000),
              /503/,
            );
            assert.equal(lease.cdp.listenerCount("protocol"), count);
            assert.equal(
              lease.cdp.listenerCount("disconnected"),
              disconnectedCount,
            );
          } finally {
            rejectFeed = false;
            await lease.close();
          }
        });
        assert.equal(await m.getPage("bet365"), a);
        assert.equal(a.context().pages().length, 2);
      }
      await a.context().unroute("**/*");
      await m.recoverPage("bet365");
      assert.equal(await m.getPage("betano"), b);
      await m.recoverBrowser();
      assert.equal(m.health().contexts, 1);
      assert.equal(m.health().tabs, 2);
      const restored = await m.getPage("bet365");
      await restored.goto(`http://127.0.0.1:${addr.port}/restored`);
      assert.equal(
        await restored.evaluate(() => localStorage.getItem("technical")),
        "kept",
      );
      // Kill only the Chrome process launched by this test, never an external browser.
      const browserSession = await restored
        .context()
        .browser()!
        .newBrowserCDPSession();
      const { processInfo } = await browserSession.send(
        "SystemInfo.getProcessInfo",
      );
      const browserPid = processInfo.find((p) => p.type === "browser")?.id;
      assert.ok(browserPid);
      const disconnected = new Promise<void>((resolve) =>
        restored.context().once("close", () => resolve()),
      );
      process.kill(browserPid, "SIGKILL");
      await disconnected;
      const [recoveredA, recoveredB] = await Promise.all([
        m.getPage("bet365"),
        m.getPage("betano"),
      ]);
      assert.notEqual(recoveredA, restored);
      assert.equal(recoveredA.context(), recoveredB.context());
      assert.equal(m.health().tabs, 2);
      assert.equal(m.health().browsers, 1);
    } finally {
      await m.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
);
