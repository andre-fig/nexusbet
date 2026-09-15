import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Test } from "@nestjs/testing";
import type { MessageEvent } from "@nestjs/common";
import { MonitorController } from "../monitor.controller.js";
import { MonitorService } from "../monitor.service.js";
import { MonitorEventsService } from "../monitor-events.service.js";
import { MonitorRepository } from "../../persistence/repositories/monitor.repository.js";
import { PersistenceNotifications } from "../../persistence/persistence-notifications.js";
import { AppConfiguration } from "../../../config/configuration.js";
import { CollectionService } from "../../collection/collection.service.js";
import { configureHttp } from "../../../bootstrap.js";
import { validate, date, uuid } from "../dto/monitor.dto.js";
const id = "7a62b705-3498-4e51-8364-37ea25cda527";
const at = "2026-09-15T00:00:00.000Z";
test("degraded provider with no listed events is excluded from matching coverage", async () => {
  const providers = [
    { id: "superbet", enabled: true, eventCount: 1, lastUpdatedAt: new Date() },
    { id: "blaze", enabled: true, eventCount: 1, lastUpdatedAt: new Date() },
    { id: "estrelabet", enabled: true, eventCount: 0, lastUpdatedAt: null },
  ];
  const repo = { providers: async () => providers } as MonitorRepository;
  let degraded = true;
  const collection = {
    operationalHealth: () => ({
      providers: {
        estrelabet: { status: degraded ? "degraded" : "ok" },
      },
    }),
    providerRuntime: () => ({
      active: true,
      status: "active",
      reason: "active",
    }),
  } as unknown as CollectionService;
  const monitor = new MonitorService(
    repo,
    { settings: { ttlMs: 600000, esports: ["cs2"] } } as AppConfiguration,
    collection,
  );
  assert.deepEqual(await monitor.expectedProviders(), {
    cs2: ["superbet", "blaze"],
  });
  degraded = false;
  assert.deepEqual(await monitor.expectedProviders(), {
    cs2: ["superbet", "blaze"],
  });
  degraded = true;
  providers[2].eventCount = 1;
  providers[2].lastUpdatedAt = new Date();
  assert.deepEqual(await monitor.expectedProviders(), {
    cs2: ["superbet", "blaze", "estrelabet"],
  });
});
test("only healthy or fresh degraded providers enter the expected count", async () => {
  const now = new Date();
  const providers = [
    { id: "healthy", enabled: true, eventCount: 1, lastUpdatedAt: now },
    { id: "degraded", enabled: true, eventCount: 1, lastUpdatedAt: now },
    ...["unavailable", "stale", "no_data", "down", "disabled"].map((id) => ({
      id,
      enabled: id !== "disabled",
      eventCount: 1,
      lastUpdatedAt: now,
    })),
  ];
  const repo = { providers: async () => providers } as MonitorRepository;
  const collection = {
    operationalHealth: () => ({
      providers: { degraded: { status: "degraded" } },
    }),
    providerRuntime: (id: string) => ({
      active: !["unavailable", "disabled"].includes(id),
      status: id === "unavailable" ? "unavailable" : "active",
      reason: id,
    }),
  } as unknown as CollectionService;
  providers.find((p) => p.id === "stale")!.lastUpdatedAt = new Date(0);
  providers.find((p) => p.id === "no_data")!.eventCount = 0;
  providers.find((p) => p.id === "down")!.lastUpdatedAt = new Date(0);
  const monitor = new MonitorService(
    repo,
    { settings: { ttlMs: 600000, esports: ["cs2"] } } as AppConfiguration,
    collection,
  );
  assert.deepEqual(await monitor.expectedProviders(), {
    cs2: ["healthy", "degraded"],
  });
  providers.find((p) => p.id === "degraded")!.lastUpdatedAt = new Date(0);
  assert.deepEqual(await monitor.expectedProviders(), { cs2: ["healthy"] });
});
function setup() {
  let state: Awaited<ReturnType<MonitorRepository["state"]>> = {
    events: [],
    issues: [],
  };
  const repo = { state: async () => state } as MonitorRepository;
  let stale = false;
  let staleMarket = false;
  const service = {
    providers: async () => [{ id: "future-provider", stale }],
    staleIssues: async () =>
      staleMarket ? [{ id: "stale:market", eventId: id }] : [],
  } as MonitorService;
  const bus = new PersistenceNotifications();
  const stream = new MonitorEventsService(bus, repo, service);
  stream.onModuleInit();
  return {
    stream,
    bus,
    setState: (s: typeof state) => (state = s),
    setStale: () => (stale = true),
    setStaleMarket: (value: boolean) => (staleMarket = value),
  };
}
test("monitor filters reject malformed, array and SQL-shaped values; IDs and zoned dates validated", () => {
  assert.throws(() => validate({ limit: "101" }));
  assert.throws(() => validate({ status: "invented" }));
  assert.throws(() => validate({ esport: ["cs2"] as unknown as string }));
  assert.throws(() => uuid("' OR 1=1"));
  assert.throws(() => date("2026-09-15T12:00:00"));
  assert.equal(date(at)?.toISOString(), at);
  assert.equal(validate({ provider: "future-provider", page: "2" }).page, "2");
});
test("SSE multiple subscribers receive small mapped domain invalidations and clean up", async () => {
  const { stream, bus } = setup();
  const a: MessageEvent[] = [],
    b: MessageEvent[] = [];
  const one = stream.stream().subscribe((x) => a.push(x)),
    two = stream.stream().subscribe((x) => b.push(x));
  await stream.refresh();
  bus.committed.next({
    provider: "superbet",
    at,
    changes: [
      {
        type: "OddsChanged",
        eventId: "external",
        marketId: "market",
        selectionId: "runner",
        fetchedAt: at,
        before: { password: "DO_NOT_SEND" },
        after: { huge: "DO_NOT_SEND" },
      },
    ],
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(stream.subscribers, 2);
  assert.ok(a.some((x) => x.type === "odds.changed"));
  assert.ok(b.some((x) => x.type === "provider.updated"));
  assert.ok(!JSON.stringify(a).includes("DO_NOT_SEND"));
  one.unsubscribe();
  assert.equal(stream.subscribers, 1);
  two.unsubscribe();
  assert.equal(stream.subscribers, 0);
  stream.onModuleDestroy();
});
test("SSE observes matching decisions, issue transitions and provider stale without changing domain", async () => {
  const { stream, setState, setStale } = setup();
  const messages: MessageEvent[] = [];
  const sub = stream.stream().subscribe((x) => messages.push(x));
  await stream.refresh();
  setState({
    events: [
      {
        id,
        providerEventId: "external",
        provider: { slug: "superbet" },
        match: {
          canonicalEventId: null,
          status: "unmatched",
          confidence: 0 as never,
        },
      },
    ],
    issues: [
      {
        id: "issue",
        status: "open",
        canonicalEventId: null,
        providerEventId: id,
      },
    ],
  });
  await stream.refresh();
  assert.ok(messages.some((x) => x.type === "issue.created"));
  assert.ok(messages.some((x) => x.type === "matching.updated"));
  setState({
    events: [],
    issues: [
      {
        id: "issue",
        status: "resolved",
        canonicalEventId: null,
        providerEventId: id,
      },
    ],
  });
  setStale();
  await stream.refresh();
  assert.ok(messages.some((x) => x.type === "issue.resolved"));
  assert.ok(messages.some((x) => x.type === "provider.stale"));
  sub.unsubscribe();
  stream.onModuleDestroy();
});
test("SSE invalidates REST when a market crosses freshness TTL or recovers", async () => {
  const { stream, setStaleMarket } = setup();
  const messages: MessageEvent[] = [];
  const subscription = stream
    .stream()
    .subscribe((message) => messages.push(message));
  await stream.refresh();
  setStaleMarket(true);
  await stream.refresh();
  assert.ok(messages.some((message) => message.type === "market.stale"));
  setStaleMarket(false);
  await stream.refresh();
  assert.ok(messages.some((message) => message.type === "market.refreshed"));
  subscription.unsubscribe();
  stream.onModuleDestroy();
});
test("heartbeat occurs at 25 seconds and timer stops after disconnect", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { stream } = setup();
  const messages: MessageEvent[] = [];
  const sub = stream.stream().subscribe((x) => messages.push(x));
  t.mock.timers.tick(24999);
  assert.equal(messages.filter((x) => x.type === "heartbeat").length, 0);
  t.mock.timers.tick(1);
  assert.equal(messages.filter((x) => x.type === "heartbeat").length, 1);
  sub.unsubscribe();
  t.mock.timers.tick(50000);
  assert.equal(messages.filter((x) => x.type === "heartbeat").length, 1);
  stream.onModuleDestroy();
});
test("Nest exposes every monitor GET, SSE, exact CORS and read-only methods", async () => {
  const { stream } = setup();
  const service = {
    overview: async () => ({ health: { events: 1 } }),
    events: async () => ({ items: [{ id }], pagination: { total: 1 } }),
    detail: async () => ({ id, markets: [] }),
    history: async () => ({ eventId: id, series: [] }),
    issues: async () => ({ items: [] }),
    providers: async () => [{ id: "future-provider" }],
    raw: async () => ({ eventId: id, raw: {} }),
  };
  const module = await Test.createTestingModule({
    controllers: [MonitorController],
    providers: [
      { provide: MonitorService, useValue: service },
      { provide: MonitorEventsService, useValue: stream },
      {
        provide: AppConfiguration,
        useValue: { settings: { monitorOrigin: "http://localhost:3000" } },
      },
    ],
  }).compile();
  const app = configureHttp(module.createNestApplication({ logger: false }));
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  try {
    for (const path of [
      "/overview",
      "/events",
      "/events/" + id,
      "/events/" + id + "/odds-history",
      "/events/" + id + "/raw",
      "/issues",
      "/providers",
    ]) {
      const r = await fetch(base + "/monitor" + path);
      assert.equal(r.status, 200);
      assert.ok(await r.json());
    }
    const cors = await fetch(base + "/monitor/events", {
      headers: { Origin: "http://localhost:3000" },
    });
    assert.equal(
      cors.headers.get("access-control-allow-origin"),
      "http://localhost:3000",
    );
    const other = await fetch(base + "/monitor/events", {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
    assert.equal(
      (await fetch(base + "/monitor/events", { method: "POST" })).status,
      405,
    );
    const abort = new AbortController();
    const r = await fetch(base + "/monitor/stream", { signal: abort.signal });
    assert.match(r.headers.get("content-type")!, /text\/event-stream/);
    const reader = r.body!.getReader();
    let first = "";
    while (!first.includes("event: ready")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      first += new TextDecoder().decode(chunk.value);
    }
    assert.match(first, /event: ready/);
    abort.abort();
    await reader.cancel().catch(() => {});
  } finally {
    await app.close();
  }
});
