import "reflect-metadata";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { chromium } from "playwright-core";
import { AppModule } from "../../collection/tests/provider-harness.js";
import {
  AppConfiguration,
  configuration,
} from "../../../config/configuration.js";
import { LocalCdpService } from "../../../shared/browser/local-cdp.service.js";
import { CdpConnection } from "../../../shared/browser/cdp-connection.js";
import { ChromeTab } from "../../../shared/browser/chrome-tab.js";
import { CollectionService } from "../collection.service.js";
import { Bet365Client } from "../../bet365/bet365.client.js";
import { BetanoClient } from "../../betano/betano.client.js";

class FakeCdp extends EventEmitter {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  targets = new Set(["personal-tab"]);
  sequence = 0;
  closeCount = 0;
  async send(method: string, params: Record<string, unknown> = {}) {
    this.calls.push({ method, params });
    if (method === "Browser.getVersion")
      return {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/152.0.0.0",
      };
    if (method === "Target.createTarget") {
      const targetId = "owned-" + ++this.sequence;
      this.targets.add(targetId);
      return { targetId };
    }
    if (method === "Target.attachToTarget")
      return { sessionId: "session-" + ++this.sequence };
    if (method === "Target.closeTarget")
      this.targets.delete(String(params.targetId));
    return {};
  }
  close() {
    this.closeCount++;
    this.emit("disconnected");
  }
}
function harness(
  t: TestContext,
  runtime: "local-cdp" | "disabled" = "local-cdp",
) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: "darwin" });
  t.after(() => Object.defineProperty(process, "platform", platform));
  const base = configuration().settings;
  const config = new AppConfiguration(
    new ConfigService({
      settings: {
        ...base,
        browser: { ...base.browser, runtime },
        providerEnabled: { bet365: true, betano: true },
        cdpUrl: "ws://127.0.0.1:9999/devtools/browser/test-" + Math.random(),
      },
    }),
  );
  const cdp = new FakeCdp();
  const connect = t.mock.method(
    CdpConnection,
    "connect",
    async () => cdp as unknown as CdpConnection,
  );
  const launch = t.mock.method(
    chromium,
    "launchPersistentContext",
    async () => {
      throw Error("MUST NOT launch");
    },
  );
  const manager = new LocalCdpService(config);
  t.after(() => manager.close());
  return { manager, config, cdp, connect, launch };
}
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

test("local-cdp reuses owned targets, keeps personal tabs, adapters only detach and shutdown only disconnects", async (t) => {
  const { manager, cdp, connect, launch } = harness(t);
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const provider of ["bet365", "betano"] as const) {
      await manager.runExclusive(provider, async () => {
        const feed = await manager.openFeed(
          provider,
          (endpoint, targetId) => ChromeTab.open(endpoint, { targetId }),
          (f) => f.detach(),
        );
        assert.equal(feed.isCurrent(), true);
        await feed.close();
        assert.equal(feed.isCurrent(), false);
      });
    }
  }
  assert.equal(connect.mock.callCount(), 1);
  assert.equal(launch.mock.callCount(), 0);
  assert.equal(cdp.targets.size, 3);
  assert.equal(
    cdp.calls.filter((c) => c.method === "Target.createTarget").length,
    2,
  );
  await manager.close();
  assert.deepEqual([...cdp.targets], ["personal-tab"]);
  assert.equal(cdp.closeCount, 1);
  for (const c of cdp.calls) {
    assert.ok(
      ![
        "Browser.close",
        "Target.disposeBrowserContext",
        "Network.clearBrowserCookies",
        "Storage.clearDataForOrigin",
      ].includes(c.method),
    );
    if (c.method === "Target.closeTarget")
      assert.match(String(c.params.targetId), /^owned-/);
  }
});
test("local-cdp serializes same provider while allowing peers", async (t) => {
  const { manager } = harness(t);
  const a = gate(),
    b = gate(),
    entered = gate();
  let count = 0;
  const action = (g: ReturnType<typeof gate>) => async () => {
    if (++count === 2) entered.resolve();
    await g.promise;
  };
  const one = manager.runExclusive("bet365", action(a));
  const two = manager.runExclusive("betano", action(b));
  await entered.promise;
  await assert.rejects(
    manager.runExclusive("bet365", async () => {}),
    /busy/,
  );
  a.resolve();
  b.resolve();
  await Promise.all([one, two]);
});
test("unsupported runtime cannot launch or connect even when provider flags are enabled", async (t) => {
  const { manager, config, connect, launch } = harness(t, "disabled");
  await assert.rejects(
    new Bet365Client(config, manager).open({ esports: ["cs2"] }),
  );
  await assert.rejects(new BetanoClient(config, manager).open());
  assert.equal(manager.availability("bet365"), "unavailable");
  assert.equal(connect.mock.callCount(), 0);
  assert.equal(launch.mock.callCount(), 0);
});
test("Linux cannot use local-cdp and disabled provider never connects", async (t) => {
  const { manager, config, connect } = harness(t);
  Object.defineProperty(process, "platform", { value: "linux" });
  await assert.rejects(manager.runExclusive("bet365", async () => {}));
  assert.equal(connect.mock.callCount(), 0);
  config.settings.providerEnabled.bet365 = false;
  assert.equal(manager.availability("bet365"), "disabled");
});
test("CDP connection failure is unavailable and reconnect attempts are bounded by cooldown", async (t) => {
  const { manager, connect } = harness(t);
  connect.mock.mockImplementation(async () => {
    throw Error("connection refused");
  });
  await assert.rejects(manager.runExclusive("bet365", async () => {}));
  await assert.rejects(manager.runExclusive("bet365", async () => {}));
  await assert.rejects(manager.runExclusive("betano", async () => {}));
  assert.equal(connect.mock.callCount(), 1);
  assert.equal(manager.availability("bet365"), "unavailable");
  assert.ok(manager.health().reconnectAfter);
});
test("shutdown drains an owned operation before closing targets", async (t) => {
  const { manager, cdp } = harness(t);
  const running = gate(),
    entered = gate();
  const job = manager.runExclusive("bet365", async () => {
    entered.resolve();
    await running.promise;
  });
  await entered.promise;
  const shutdown = manager.close();
  assert.equal(cdp.targets.size, 2);
  await assert.rejects(manager.runExclusive("betano", async () => {}));
  running.resolve();
  await job;
  await shutdown;
  assert.deepEqual([...cdp.targets], ["personal-tab"]);
});
test("Nest boots with unavailable browser and scheduler excludes unsupported providers", async () => {
  const base = configuration().settings;
  const settings = {
    ...base,
    persistenceMode: "file" as const,
    scanEnabled: false,
    ingestEnabled: false,
    collection: { ...base.collection, enabled: false },
    browser: { ...base.browser, runtime: "disabled" as const },
    providerEnabled: { bet365: true, betano: false },
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfiguration)
    .useValue({ settings })
    .compile();
  const app = module.createNestApplication({ logger: false });
  try {
    await app.init();
    const collection = app.get(CollectionService);
    assert.equal(collection.scheduler.providers.has("bet365"), false);
    assert.equal(collection.scheduler.providers.has("betano"), false);
    assert.equal(collection.scheduler.providers.has("superbet"), true);
    const health = collection.operationalHealth();
    assert.equal(
      (health.providers.bet365 as { status: string }).status,
      "disabled",
    );
    assert.equal(
      (health.providers.betano as { status: string }).status,
      "disabled",
    );
    assert.deepEqual(collection.activeProviderNames(), [
      "superbet",
      "blaze",
      "estrelabet",
    ]);
    assert.deepEqual(collection.providerRuntime("bet365"), {
      active: false,
      status: "disabled",
      reason: "disabled_in_runtime",
    });
    assert.deepEqual(collection.providerRuntime("betano"), {
      active: false,
      status: "disabled",
      reason: "disabled_in_runtime",
    });
    assert.equal(
      (health.providers.bet365 as { consecutiveFailures: number })
        .consecutiveFailures,
      0,
    );
    assert.equal(
      (health.providers.bet365 as { lastError: string | null }).lastError,
      null,
    );
  } finally {
    await app.close();
  }
});

test("local Bet365 captures repeated scopes without replacing or closing the owned target", async (t) => {
  const { manager, config, cdp } = harness(t);
  const { codes } = await import("../../bet365/types/model.js");
  const pd = `#AC#B151#C1#D50#E${codes.cs2}#F163#`;
  const path = "/contentdata/othersportsmatchmarketscontentapi/list";
  const source =
    "https://www.bet365.bet.br" + path + "?pd=" + encodeURIComponent(pd);
  const original = cdp.send.bind(cdp);
  t.mock.method(
    cdp,
    "send",
    async (
      method: string,
      params: Record<string, unknown> = {},
      ...rest: unknown[]
    ) => {
      const sessionId = rest[0];
      if (method === "Runtime.evaluate") return { result: { value: true } };
      if (method === "Network.getResponseBody")
        return { body: "F|CL;ID=151;|", base64Encoded: false };
      const result = await original(method, params);
      if (method === "Page.navigate" && String(params.url).includes("/#/")) {
        const emit = (name: string, fields: Record<string, unknown>) =>
          cdp.emit("protocol", {
            sessionId,
            method: name,
            params: { requestId: "feed", ...fields },
          });
        emit("Network.requestWillBeSent", {
          request: { url: source, headers: { accept: "text/plain" } },
        });
        emit("Network.responseReceived", {
          response: { url: source, status: 200 },
        });
        emit("Network.loadingFinished", {});
      }
      return result;
    },
  );
  const client = new Bet365Client(config, manager);
  for (let i = 0; i < 2; i++)
    await client.run(async () => {
      const feed = await client.open({ esports: ["cs2"] });
      try {
        const capture = await feed.capture("cs2", pd, path, 1000);
        assert.equal(capture.status, 200);
      } finally {
        await feed.close();
      }
    });
  assert.equal(
    cdp.calls.filter((c) => c.method === "Target.createTarget").length,
    1,
  );
  assert.equal(
    cdp.calls.filter((c) => c.method === "Target.closeTarget").length,
    0,
  );
  assert.equal(cdp.listenerCount("protocol"), 1); // Only the owner's target lifecycle listener remains.
});

test("closing an owned target replaces only that target and removes its lifecycle listeners", async (t) => {
  const { manager, cdp, connect } = harness(t);
  await manager.runExclusive("bet365", async () => {});
  await manager.runExclusive("betano", async () => {});
  cdp.targets.delete("owned-1");
  cdp.emit("protocol", {
    method: "Target.detachedFromTarget",
    params: { sessionId: "session-2" },
  });
  assert.equal(manager.health().ownedTabs, 1);
  await manager.runExclusive("bet365", async () => {});
  assert.equal(manager.health().ownedTabs, 2);
  assert.ok(cdp.targets.has("personal-tab"));
  assert.ok(cdp.targets.has("owned-3"));
  assert.equal(connect.mock.callCount(), 1);
  assert.equal(cdp.listenerCount("protocol"), 2);
});

test("a headless CDP endpoint is rejected without browser shutdown or fallback", async (t) => {
  const { manager, cdp, launch } = harness(t);
  const original = cdp.send.bind(cdp);
  t.mock.method(
    cdp,
    "send",
    async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "Browser.getVersion")
        return {
          userAgent: "Mozilla/5.0 (Macintosh) HeadlessChrome/152.0.0.0",
        };
      return original(method, params);
    },
  );
  await assert.rejects(
    manager.runExclusive("bet365", async () => {
      assert.fail("must not collect");
    }),
  );
  assert.deepEqual([...cdp.targets], ["personal-tab"]);
  assert.equal(launch.mock.callCount(), 0);
  assert.equal(manager.availability("bet365"), "unavailable");
});
