import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { ChromeTab } from "../../../shared/browser/chrome-tab.js";
test("parallel provider tabs share a CDP connection; closing one does not close the other", async () => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  let connections = 0,
    counter = 0;
  const closed: string[] = [];
  server.on("connection", (socket) => {
    connections++;
    socket.on("message", (raw) => {
      const q = JSON.parse(String(raw));
      let result: Record<string, unknown> = {};
      if (q.method === "Target.createBrowserContext")
        result = { browserContextId: "context" + counter++ };
      if (q.method === "Target.createTarget")
        result = { targetId: "target" + counter++ };
      if (q.method === "Target.attachToTarget")
        result = { sessionId: "session" + counter++ };
      if (q.method === "Target.closeTarget") closed.push(q.params.targetId);
      socket.send(JSON.stringify({ id: q.id, result }));
    });
  });
  const endpoint = "ws://127.0.0.1:" + (server.address() as AddressInfo).port;
  try {
    const [a, b] = await Promise.all([
      ChromeTab.open(endpoint, { anonymous: true }),
      ChromeTab.open(endpoint, { anonymous: true }),
    ]);
    assert.equal(connections, 1);
    assert.equal(a.cdp, b.cdp);
    assert.notEqual(a.browserContextId, b.browserContextId);
    assert.notEqual(a.sessionId, b.sessionId);
    await a.close();
    await b.cdp.send("Page.enable", {}, b.sessionId);
    assert.deepEqual(closed, [a.targetId]);
    await b.close();
    assert.deepEqual(closed, [a.targetId, b.targetId]);
    const c = await ChromeTab.open(endpoint, { anonymous: true });
    assert.equal(connections, 2);
    await c.close();
  } finally {
    for (const client of server.clients) client.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
