import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Test } from "@nestjs/testing";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EstrelaBetModule } from "../estrelabet.module.js";
import { EstrelaBetService } from "../estrelabet.service.js";
import { EstrelaBetClient } from "../estrelabet.client.js";
import { Bet365Service } from "../../bet365/bet365.service.js";
import {
  AppConfiguration,
  configuration,
} from "../../../config/configuration.js";
import { configureHttp } from "../../../bootstrap.js";
import { AdaptiveScheduler } from "../../collection/adaptive-scheduler.js";
import { ProviderTransportError } from "../../../shared/errors/domain-errors.js";
import { parseListing } from "../parsers/feed.parser.js";
import type { EstrelaBetCapture } from "../types/feed.js";
import { fixture, eventIds } from "./fixtures.js";
test("EstrelaBet independent Nest module: API, health, failure preserves snapshots and disabled prevents HTTP", async () => {
  const dir = await mkdtemp(join(tmpdir(), "estrelabet-nest-"));
  const settings = {
    ...configuration().settings,
    persistenceMode: "file" as const,
    estrelabetEnabled: true,
    estrelabetInboxDir: join(dir, "inbox"),
    dataDir: join(dir, "data"),
    ttlMs: 1e12,
  };
  let fail = false,
    calls = 0;
  const mod = await Test.createTestingModule({ imports: [EstrelaBetModule] })
    .overrideProvider(AppConfiguration)
    .useValue({ settings })
    .overrideProvider(EstrelaBetClient)
    .useValue({
      snapshot: async (_signal?: AbortSignal, eventId?: string) => {
        calls++;
        if (fail)
          throw new ProviderTransportError("estrelabet", Error("HTTP 403"));
        return fixture(eventId ? "cs2" : "list");
      },
      close: async () => {},
    })
    .compile();
  const app = configureHttp(
    mod.createNestApplication({ logger: false, bodyParser: false }),
  );
  try {
    assert.throws(() => mod.get(Bet365Service));
    await app.listen(0, "127.0.0.1");
    const service = app.get(EstrelaBetService),
      options = {
        esports: ["cs2", "lol", "valorant"] as ("cs2" | "lol" | "valorant")[],
      };
    await service.collectEvents(options);
    await service.collectEventDetails(
      { provider: "estrelabet", esport: "cs2", eventId: "17707439" },
      options,
    );
    const url = await app.getUrl();
    assert.equal(
      (await fetch(url + "/providers/estrelabet/events")).status,
      200,
    );
    assert.equal(
      (await fetch(url + "/providers/estrelabet/events/17707439")).status,
      200,
    );
    const health = await (
      await fetch(url + "/providers/estrelabet/health")
    ).json();
    assert.equal(health.eventCount, 41);
    assert.equal(health.transport, "http");
    const before = service.readEvents(options.esports);
    fail = true;
    await assert.rejects(() => service.collectEvents(options));
    assert.deepEqual(service.readEvents(options.esports), before);
    settings.estrelabetEnabled = false;
    const previous = calls;
    await assert.rejects(() => service.collectEvents(options));
    assert.equal(calls, previous);
    settings.ttlMs = 1;
    assert.equal(
      (await fetch(url + "/providers/estrelabet/events")).status,
      503,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("EstrelaBet generic scheduler: concurrency, transport backoff, circuit breaker and provider isolation", async () => {
  const config = {
    ...configuration().settings.collection,
    jitterMs: 0,
    startupDelayMs: 0,
    failureThreshold: 1,
  };
  let now = Date.parse((await fixture()).capturedAt);
  let fail = true,
    calls = 0;
  const scheduler = new AdaptiveScheduler(
    config,
    ["estrelabet", "superbet"],
    async (job) => {
      if (job.provider === "estrelabet") {
        calls++;
        if (fail) throw new ProviderTransportError("estrelabet", Error("403"));
        return parseListing(await fixture(), "cs2");
      }
      return [];
    },
    () => {},
    () => now,
    () => 0,
  );
  scheduler.start();
  await scheduler.tick();
  await scheduler.drain();
  assert.equal(scheduler.providers.get("estrelabet")!.consecutiveFailures, 1);
  assert.ok(scheduler.providers.get("estrelabet")!.cooldownUntil! > now);
  const before = calls;
  await scheduler.tick();
  await scheduler.drain();
  assert.equal(calls, before);
  assert.equal(scheduler.providers.get("superbet")!.activeJobs, 0);
  now += config.cooldownMs + 1;
  fail = false;
  await scheduler.tick();
  await scheduler.drain();
  assert.equal(scheduler.providers.get("estrelabet")!.consecutiveFailures, 0);
  assert.equal(scheduler.providers.get("estrelabet")!.effectiveConcurrency, 1);
  await scheduler.stop();
});

import { AppModule } from "../../../app.module.js";
import { ODDS_PROVIDERS } from "../../collection/provider-registry.js";
import { CollectionService } from "../../collection/collection.service.js";
import { object, rows } from "../types/feed.js";
test("Nest CollectionModule publishes EstrelaBet scheduled list/detail and exposes successful /health without a browser", async () => {
  const dir = await mkdtemp(join(tmpdir(), "estrelabet-scheduled-"));
  const settings = {
    ...configuration().settings,
    persistenceMode: "file" as const,
    estrelabetEnabled: true,
    dataDir: join(dir, "data"),
    estrelabetInboxDir: join(dir, "inbox"),
    scanEnabled: false,
    collection: {
      ...configuration().settings.collection,
      enabled: false,
      startupDelayMs: 0,
      jitterMs: 0,
    },
  };
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfiguration)
    .useValue({ settings })
    .overrideProvider(ODDS_PROVIDERS)
    .useFactory({
      factory: (service: EstrelaBetService) => [service],
      inject: [EstrelaBetService],
    })
    .overrideProvider(EstrelaBetClient)
    .useValue({
      snapshot: async (_signal?: AbortSignal, eventId?: string) => {
        const sport =
          Object.entries(eventIds).find(([, id]) => id === eventId)?.[0] ??
          "cs2";
        const c = await fixture(eventId ? sport : "list");
        const now = Date.now();
        c.capturedAt = new Date(now).toISOString();
        if (c.data.detail)
          object(c.data.detail).startDate = new Date(
            now + 7200000,
          ).toISOString();
        for (const p of c.data.pages ?? []) {
          object(p).events = rows(object(p).events).filter((e) =>
            Object.values(eventIds).includes(String(e.id)),
          );
          for (const e of rows(object(p).events))
            e.startDate = new Date(now + 7200000).toISOString();
        }
        return c;
      },
      close: async () => {},
    })
    .compile();
  const app = configureHttp(
    mod.createNestApplication({ logger: false, bodyParser: false }),
  );
  try {
    await app.listen(0, "127.0.0.1");
    const collection = app.get(CollectionService);
    collection.scheduler.start();
    await collection.scheduler.tick();
    await collection.scheduler.drain();
    await collection.scheduler.tick();
    await collection.scheduler.drain();
    const health = await (await fetch((await app.getUrl()) + "/health")).json();
    assert.equal(health.providers.estrelabet.status, "ok");
    assert.ok(health.providers.estrelabet.lastListSuccessAt);
    assert.equal(health.providers.estrelabet.activeJobs, 0);
    assert.equal(app.get(EstrelaBetService).store.details.size, 1);
    assert.equal(
      (await fetch((await app.getUrl()) + "/providers/estrelabet/events"))
        .status,
      200,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("EstrelaBet HTTP pagination, no credentials, detail endpoint and stop at first HTTP failure", async (t) => {
  const c = await fixture(),
    d = await fixture("cs2");
  let calls = 0;
  const config = { settings: configuration().settings } as AppConfiguration;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, options?: RequestInit) => {
      calls++;
      assert.equal(options?.headers, undefined);
      assert.equal(options?.redirect, "error");
      const u = new URL(String(input));
      assert.equal(u.searchParams.get("integration"), "estrelabet");
      return new Response(
        JSON.stringify(
          u.pathname.endsWith("GetEventDetails")
            ? d.data.detail
            : c.data.pages![Number(u.searchParams.get("page") ?? 1) - 1],
        ),
        { headers: { "content-type": "application/json" } },
      );
    },
  );
  const client = new EstrelaBetClient(config);
  assert.deepEqual((await client.snapshot()).data, c.data);
  assert.equal(calls, 4);
  assert.deepEqual(
    (await client.snapshot(undefined, eventIds.cs2)).data,
    d.data,
  );
  t.mock.restoreAll();
  calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response("blocked", { status: 403 });
  });
  await assert.rejects(() => client.snapshot(), ProviderTransportError);
  assert.equal(calls, 1);
  t.mock.restoreAll();
  config.settings.collection.listTimeoutMs = 5;
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, options?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(Error("aborted")),
          { once: true },
        );
      }),
  );
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(() => client.snapshot(), ProviderTransportError);
  } finally {
    clearTimeout(keepAlive);
    await client.close();
  }
});
test("EstrelaBet validates changed pagination before any publication", async (t) => {
  const c = await fixture();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const p = structuredClone(object(c.data.pages![calls++]));
    if (calls === 2) p.pageCount = 99;
    return new Response(JSON.stringify(p), {
      headers: { "content-type": "application/json" },
    });
  });
  const client = new EstrelaBetClient({
    settings: configuration().settings,
  } as AppConfiguration);
  await assert.rejects(() => client.snapshot(), ProviderTransportError);
  assert.equal(calls, 2);
});
test("EstrelaBet enabled and concurrency configuration is explicit and validated", () => {
  const old = process.env.ESTRELABET_ENABLED,
    concurrency = process.env.ESTRELABET_MAX_CONCURRENCY;
  try {
    delete process.env.ESTRELABET_ENABLED;
    delete process.env.ESTRELABET_MAX_CONCURRENCY;
    assert.equal(configuration().settings.estrelabetEnabled, true);
    assert.equal(configuration().settings.collection.concurrency.estrelabet, 1);
    process.env.ESTRELABET_ENABLED = "false";
    assert.equal(configuration().settings.estrelabetEnabled, false);
    process.env.ESTRELABET_ENABLED = "invalid";
    assert.throws(() => configuration(), /ESTRELABET_ENABLED/);
  } finally {
    if (old === undefined) delete process.env.ESTRELABET_ENABLED;
    else process.env.ESTRELABET_ENABLED = old;
    if (concurrency === undefined)
      delete process.env.ESTRELABET_MAX_CONCURRENCY;
    else process.env.ESTRELABET_MAX_CONCURRENCY = concurrency;
  }
});
