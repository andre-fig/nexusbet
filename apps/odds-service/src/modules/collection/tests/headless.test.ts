import { LocalCdpService } from "../../../shared/browser/local-cdp.service.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import { openHeadlessFeed } from "../../../shared/browser/headless-feed.js";
import { ChromeTab } from "../../../shared/browser/chrome-tab.js";
import { configuration } from "../../../config/configuration.js";

test("headed defaults on, supports explicit legacy headless selection and rejects invalid configuration", () => {
  const original = process.env.HEADLESS;
  try {
    delete process.env.HEADLESS;
    assert.equal(configuration().settings.headless, false);
    for (const value of ["1", "true"]) {
      process.env.HEADLESS = value;
      assert.equal(configuration().settings.headless, true);
    }
    for (const value of ["0", "false"]) {
      process.env.HEADLESS = value;
      assert.equal(configuration().settings.headless, false);
    }
    process.env.HEADLESS = "typo";
    assert.throws(configuration, /Invalid HEADLESS/);
  } finally {
    if (original === undefined) delete process.env.HEADLESS;
    else process.env.HEADLESS = original;
  }
});
test("owned headless profile and browser are closed exactly once, including transport failure", async (t) => {
  let profile = "",
    browserClosed = 0,
    feedClosed = 0;
  t.mock.method(
    chromium,
    "launchPersistentContext",
    async (path: string, options: { headless: boolean }) => {
      profile = path;
      assert.equal(options.headless, true);
      await writeFile(
        join(path, "DevToolsActivePort"),
        "12345\n/devtools/browser/owned\n",
      );
      return {
        close: async () => {
          browserClosed++;
        },
      } as BrowserContext;
    },
  );
  const feed = await openHeadlessFeed(async (endpoint) => {
    assert.equal(endpoint, "ws://127.0.0.1:12345/devtools/browser/owned");
    return {
      close: async () => {
        feedClosed++;
      },
    };
  });
  await Promise.all([feed.close(), feed.close()]);
  assert.equal(feedClosed, 1);
  assert.equal(browserClosed, 1);
  await assert.rejects(access(profile));
  await assert.rejects(
    openHeadlessFeed(async () => {
      throw Error("transport unavailable");
    }),
  );
  assert.equal(browserClosed, 2);
  await assert.rejects(access(profile));
});
test(
  "owned Chrome runs headless through the existing CDP transport and closes without a user browser",
  { skip: process.env.BROWSER_TESTS !== "1" },
  async () => {
    const feed = await openHeadlessFeed((endpoint) =>
      ChromeTab.open(endpoint, { anonymous: true }),
    );
    try {
      const version = await feed.cdp.send("Browser.getVersion");
      assert.match(version.userAgent, /HeadlessChrome/);
      const result = await feed.cdp.send(
        "Runtime.evaluate",
        { expression: "6*7", returnByValue: true },
        feed.sessionId,
      );
      assert.equal(result.result.value, 42);
    } finally {
      await feed.close();
    }
  },
);

test("unsupported runtime never launches Chrome or falls back even with existing/reuse options", async (t) => {
  const { Bet365Client } = await import("../../bet365/bet365.client.js");
  const { BetanoClient } = await import("../../betano/betano.client.js");
  const { AppConfiguration } = await import("../../../config/configuration.js");
  const { ConfigService } = await import("@nestjs/config");
  const settings = {
    ...configuration().settings,
    headless: true,
    browser: {
      ...configuration().settings.browser,
      runtime: "disabled" as const,
    },
    cdpUrl: "ws://127.0.0.1:1/devtools/browser/personal",
  };
  const config = new AppConfiguration(new ConfigService({ settings }));
  const launch = t.mock.method(
    chromium,
    "launchPersistentContext",
    async () => {
      throw Error("headless launch unavailable");
    },
  );
  const verify = (error: unknown) =>
    error instanceof Error &&
    error.cause instanceof Error &&
    error.cause.message.includes("unavailable");
  await assert.rejects(
    new Bet365Client(config, new LocalCdpService(config)).open({
      esports: ["cs2"],
      existing: true,
      reuseProfile: true,
    }),
    verify,
  );
  await assert.rejects(
    new BetanoClient(config, new LocalCdpService(config)).open(),
    verify,
  );
  assert.equal(launch.mock.callCount(), 0);
});
