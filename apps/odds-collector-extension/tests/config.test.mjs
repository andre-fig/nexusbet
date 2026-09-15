import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("missing private resource keeps an installed extension dormant, then permits configuration", async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const url = "chrome-extension://collector/private-config.json";
  globalThis.chrome = { runtime: { getURL: () => url } };
  globalThis.fetch = async () => {
    throw Error("Resource unavailable");
  };
  try {
    const bundle = await build({
      entryPoints: [join(root, "src", "publisher.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "chrome120",
    });
    const publisher = await import(
      `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
    );
    assert.equal(await publisher.config(), null);
    globalThis.fetch = async (requested) => {
      assert.equal(requested, url);
      return {
        ok: true,
        json: async () => ({
          serverUrl: "https://odds-service-production-f25c.up.railway.app/",
          token: "x".repeat(32),
        }),
      };
    };
    assert.equal((await publisher.config()).token.length, 32);
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
