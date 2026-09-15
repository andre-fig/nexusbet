import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduledOperation } from "../scheduled-operation.js";
import { readFile } from "node:fs/promises";
import type {
  ProviderRuntime,
  CollectOptions,
} from "../../../shared/interfaces/odds-provider.interface.js";
import { parseCapture } from "../../bet365/parsers/list.parser.js";
import { normalizedBet365 } from "../../bet365/mappers/bet365.mapper.js";
async function fixture() {
  const c = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const p = parseCapture(c);
  return normalizedBet365(p.matches, p.provenance);
}
async function context() {
  const events = await fixture();
  let closed = 0;
  const provider: ProviderRuntime = {
    name: "bet365",
    pollCadence: "esport",
    collectEvents: async () => events,
    collectEventDetails: async () => events[0],
    readEvents: () => events,
    readDetail: () => events[0],
    refresh: async () => {},
    health: () => ({}),
    selectDetail: () => undefined,
    closeCollection: async () => {
      closed++;
    },
  };
  return { events, provider, closed: () => closed };
}
test("timeout after staged capture discards publication and closes owned transport", async () => {
  const c = await context(),
    abort = new AbortController();
  let release!: () => void,
    published = false;
  c.provider.collectEvents = async (options) => {
    options.publications!.push(async () => {
      published = true;
    });
    await new Promise<void>((r) => {
      release = r;
    });
    return c.events;
  };
  const result = scheduledOperation(
    c.provider,
    { kind: "list", provider: "bet365" },
    { esports: ["cs2"] },
    abort.signal,
    () => {},
  );
  while (!release) await new Promise((r) => setImmediate(r));
  abort.abort(new Error("timeout"));
  release();
  await assert.rejects(result, /timeout/);
  assert.equal(published, false);
  assert.equal(c.closed(), 1);
});
test("valid deferred capture commits once; invalid result never commits", async () => {
  const c = await context();
  const order: string[] = [];
  c.provider.collectEvents = async (options) => {
    options.publications!.push(async () => {
      order.push("publish");
    });
    return c.events;
  };
  await scheduledOperation(
    c.provider,
    { kind: "list", provider: "bet365" },
    { esports: ["cs2"] },
    new AbortController().signal,
    () => {
      order.push("commit");
    },
  );
  assert.deepEqual(order, ["commit", "publish"]);
  order.length = 0;
  c.provider.collectEvents = async (options) => {
    options.publications!.push(async () => {
      order.push("bad");
    });
    return [c.events[0], c.events[0]];
  };
  await assert.rejects(
    scheduledOperation(
      c.provider,
      { kind: "list", provider: "bet365" },
      { esports: ["cs2"] },
      new AbortController().signal,
      () => {},
    ),
    /Invalid/,
  );
  assert.deepEqual(order, []);
});
test("late transition into live/start does not publish pre-game detail or invent finished status", async () => {
  const c = await context();
  let published = false;
  const e = {
    ...c.events[0],
    startsAt: new Date(Date.now() - 1).toISOString(),
  };
  c.provider.collectEventDetails = async (_ref, options: CollectOptions) => {
    options.publications!.push(async () => {
      published = true;
    });
    return e;
  };
  await assert.rejects(
    scheduledOperation(
      c.provider,
      {
        kind: "detail",
        provider: "bet365",
        event: { provider: "bet365", eventId: e.eventId, esport: e.esport },
      },
      { esports: ["cs2"] },
      new AbortController().signal,
      () => {},
    ),
    /Pre-game/,
  );
  assert.equal(published, false);
  assert.notEqual(e.status, "finished");
});
