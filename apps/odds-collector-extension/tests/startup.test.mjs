import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Chrome startup leaves collection paused even when a token is packaged", async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  let tabsCreated = 0;
  let networkPosts = 0;
  let sawActivation;
  const activationRead = new Promise((resolve) => {
    sawActivation = resolve;
  });
  globalThis.chrome = {
    runtime: {
      getURL: (name) => `chrome-extension://collector/${name}`,
      onMessage: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      reload: () => {
        throw Error("Unexpected reload");
      },
    },
    alarms: { onAlarm: { addListener: () => {} }, create: () => {} },
    storage: {
      local: {
        get: async (key) => {
          if (key === "collectorEnabled") sawActivation();
          return {};
        },
        set: async () => {},
      },
    },
    tabs: {
      create: async () => {
        tabsCreated++;
        throw Error("Unexpected tab");
      },
    },
  };
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") networkPosts++;
    if (url.endsWith("build-id.txt"))
      return { ok: true, text: async () => "test-build" };
    if (url.endsWith("private-config.json"))
      return {
        ok: true,
        json: async () => ({
          serverUrl: "https://odds-service-production-f25c.up.railway.app/",
          token: "x".repeat(32),
        }),
      };
    throw Error("Unexpected fetch");
  };
  try {
    const bundle = await build({
      entryPoints: [join(root, "src", "background.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "chrome120",
    });
    await import(
      `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
    );
    await Promise.race([
      activationRead,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Error("Startup did not reach activation")),
          1000,
        ),
      ),
    ]);
    assert.equal(tabsCreated, 0);
    assert.equal(networkPosts, 0);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
