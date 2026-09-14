import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { CdpFeed } from "../transport/cdp-feed.js";
import { parseCapture } from "../parsers/list.parser.js";
test("CDP transport owns one isolated tab, reuses its connection, filters sessions and reads native bodies", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("../fixtures/lol.json", import.meta.url), "utf8"),
  );
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  let body = fixture.body,
    status = 200;
  const methods: string[] = [];
  let navigation = 0;
  server.on("connection", (socket) => {
    const emit = (method: string, params: any, sessionId = "ours") =>
      socket.send(JSON.stringify({ method, params, sessionId }));
    socket.on("message", (data) => {
      const m = JSON.parse(String(data));
      methods.push(m.method);
      let result: any = {};
      if (m.method === "Target.createBrowserContext")
        result = { browserContextId: "isolated" };
      if (m.method === "Target.createTarget") {
        assert.equal(m.params.browserContextId, "isolated");
        result = { targetId: "owned" };
      }
      if (m.method === "Target.attachToTarget") result = { sessionId: "ours" };
      if (m.method === "Network.getResponseBody")
        result = {
          body:
            m.params.requestId === "config"
              ? JSON.stringify({ flashvars: { LOGGED_IN: false } })
              : body,
          base64Encoded: false,
        };
      if (m.method === "Target.closeTarget")
        assert.equal(m.params.targetId, "owned");
      if (m.method === "Target.disposeBrowserContext")
        assert.equal(m.params.browserContextId, "isolated");
      socket.send(JSON.stringify({ id: m.id, result }));
      if (
        ["Page.navigate", "Page.reload"].includes(m.method) &&
        m.params?.url !== "about:blank"
      ) {
        navigation++;
        const request = (requestId: string, url: string) => {
          emit("Network.requestWillBeSent", {
            requestId,
            request: {
              url,
              headers: { "x-request-id": "must-not-be-persisted" },
            },
          });
          emit("Network.responseReceived", {
            requestId,
            response: { url, status: requestId === "config" ? 200 : status },
          });
          emit("Network.loadingFinished", { requestId });
        };
        emit(
          "Network.responseReceived",
          {
            requestId: "unrelated",
            response: { url: fixture.source.url, status: 403 },
          },
          "another-user-tab",
        );
        request(
          "config",
          "https://www.bet365.bet.br/defaultapi/sports-configuration",
        );
        request("feed-" + navigation, fixture.source.url);
      }
    });
  });
  const client = await CdpFeed.open(
    "ws://127.0.0.1:" + (server.address() as any).port,
    { anonymous: true },
  );
  try {
    const pd = new URL(fixture.source.url).searchParams.get("pd")!;
    for (let i = 0; i < 2; i++) {
      const c = await client.capture(
        "lol",
        pd,
        "/contentdata/othersportsmatchmarketscontentapi/list",
      );
      assert.equal(c.source.capture, "chrome-cdp-response");
      assert.equal(c.source.authenticated, false);
      assert.ok(parseCapture(c).matches.length);
      assert.ok(!JSON.stringify(c).includes("must-not-be-persisted"));
    }
    body = "";
    await assert.rejects(
      client.capture(
        "lol",
        pd,
        "/contentdata/othersportsmatchmarketscontentapi/list",
      ),
      /Empty/,
    );
    body = fixture.body;
    status = 403;
    await assert.rejects(
      client.capture(
        "lol",
        pd,
        "/contentdata/othersportsmatchmarketscontentapi/list",
      ),
      /HTTP 403/,
    );
    assert.equal(methods.filter((m) => m === "Target.createTarget").length, 4);
    assert.ok(!methods.includes("Target.setAutoAttach"));
    assert.equal(navigation, 4);
  } finally {
    await client.close();
    assert.ok(!methods.includes("Target.disposeBrowserContext"));
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
