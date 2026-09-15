import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invalidations,
  connectStream,
  eventTypes,
} from "../src/lib/sse/monitor-stream";
import { get, query } from "../src/lib/api/client";
test("targeted invalidation keeps unrelated detail/history intact", () => {
  assert.deepEqual(invalidations("odds.changed", "a", "b"), ["events"]);
  assert.ok(invalidations("odds.changed", "a", "a").includes("history"));
  assert.deepEqual(invalidations("provider.updated", undefined, "a"), [
    "overview",
    "events",
  ]);
  assert.ok(invalidations("issue.created", "a", "a").includes("issues"));
  assert.deepEqual(invalidations("market.stale", "a", "a"), [
    "overview",
    "events",
    "issues",
    "detail",
  ]);
  assert.deepEqual(invalidations("market.refreshed", "a", "b"), [
    "overview",
    "events",
    "issues",
  ]);
  assert.ok(invalidations("ready", undefined, "a").includes("detail"));
});
test("EventSource uses named messages, reconnection status and cleans listeners", () => {
  const source = new EventTarget() as EventSource;
  let closed = false;
  source.close = () => {
    closed = true;
  };
  const statuses: string[] = [],
    messages: string[] = [];
  let url = "";
  const close = connectStream(
    (t) => messages.push(t),
    (s) => statuses.push(s),
    (u) => {
      url = u;
      return source;
    },
  );
  assert.match(url, /\/monitor\/stream$/);
  source.onopen!(new Event("open"));
  source.dispatchEvent(
    new MessageEvent("odds.changed", { data: '{"eventId":"a"}' }),
  );
  source.onerror!(new Event("error"));
  source.onopen!(new Event("open"));
  assert.deepEqual(statuses, ["connected", "reconnecting", "connected"]);
  assert.deepEqual(messages, ["odds.changed"]);
  close();
  source.dispatchEvent(new MessageEvent("odds.changed", { data: "{}" }));
  assert.equal(messages.length, 1);
  assert.ok(closed);
  assert.ok(eventTypes.includes("issue.resolved"));
});
test("REST client encodes filters and does not replace errors with mock data", async () => {
  assert.equal(
    query({ search: "A & B", provider: undefined }),
    "?search=A+%26+B",
  );
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("", { status: 503 });
    await assert.rejects(get("/monitor/overview"), /503/);
  } finally {
    globalThis.fetch = original;
  }
});
