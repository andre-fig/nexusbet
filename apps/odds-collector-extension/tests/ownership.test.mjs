import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("browser collection owns only tabs created by the extension", async () => {
  const touched = [];
  const existingTab = 7;
  const createdTab = 44;
  const original = globalThis.chrome;
  globalThis.chrome = {
    tabs: {
      create: async (options) => {
        assert.equal(options.url, "about:blank");
        touched.push(["create", createdTab]);
        return { id: createdTab };
      },
      remove: async (id) => touched.push(["remove", id]),
    },
    debugger: {
      attach: async (target) => touched.push(["attach", target.tabId]),
      sendCommand: async (target, method) => {
        touched.push([method, target.tabId]);
        return {};
      },
    },
  };
  try {
    const bundle = await build({
      entryPoints: [join(root, "src", "browser", "owned-tab.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "chrome120",
    });
    const { OwnedTab } = await import(
      `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
    );
    const tab = await OwnedTab.open("bet365");
    await assert.rejects(
      tab.navigate("https://www.betano.bet.br/"),
      /Unsupported bookmaker navigation/,
    );
    await tab.close();
    assert.ok(touched.length > 0);
    assert.ok(touched.every(([, id]) => id === createdTab));
    assert.ok(!touched.some(([, id]) => id === existingTab));
  } finally {
    globalThis.chrome = original;
  }
});

test("a partial bookmaker response cannot win over a later full feed", async () => {
  const original = globalThis.chrome;
  const listeners = new Set();
  const detach = new Set();
  const feedPath = "/contentdata/othersportsmatchmarketscontentapi/list";
  const feedUrl = `https://www.bet365.bet.br${feedPath}?pd=%23AC%23B151%23`;
  const emit = (method, params) => {
    for (const listener of listeners) listener({ tabId: 44 }, method, params);
  };
  globalThis.chrome = {
    tabs: { create: async () => ({ id: 44 }), remove: async () => {} },
    debugger: {
      attach: async () => {},
      onEvent: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
      onDetach: {
        addListener: (listener) => detach.add(listener),
        removeListener: (listener) => detach.delete(listener),
      },
      sendCommand: async (_target, method, params) => {
        if (method === "Network.getResponseBody")
          return {
            body: params.requestId === "partial" ? "P|partial" : "F|full",
          };
        return {};
      },
    },
  };
  try {
    const bundle = await build({
      entryPoints: [join(root, "src", "browser", "owned-tab.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "chrome120",
    });
    const { OwnedTab } = await import(
      `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
    );
    const tab = await OwnedTab.open("bet365");
    const capture = await tab.capture(
      feedPath,
      () => true,
      async () => {
        for (const requestId of ["partial", "full"])
          emit("Network.responseReceived", {
            requestId,
            response: { url: feedUrl, status: 200 },
          });
        for (const requestId of ["partial", "full"])
          emit("Network.loadingFinished", { requestId });
      },
      1000,
      (body) => body.startsWith("F|"),
    );
    assert.equal(capture.body, "F|full");
    await tab.close();
    assert.equal(listeners.size, 0);
    assert.equal(detach.size, 0);
  } finally {
    globalThis.chrome = original;
  }
});
