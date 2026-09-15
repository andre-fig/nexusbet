import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Test } from "@nestjs/testing";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BlazeModule } from "../blaze.module.js";
import { BlazeService } from "../blaze.service.js";
import { BlazeClient } from "../blaze.client.js";
import { Bet365Service } from "../../bet365/bet365.service.js";
import {
  AppConfiguration,
  configuration,
} from "../../../config/configuration.js";
import { configureHttp } from "../../../bootstrap.js";
import { AdaptiveScheduler } from "../../collection/adaptive-scheduler.js";
import { ProviderTransportError } from "../../../shared/errors/domain-errors.js";
import { parseListing } from "../parsers/feed.parser.js";
import type { BlazeCapture } from "../types/feed.js";
const fixture = async (): Promise<BlazeCapture> =>
  JSON.parse(
    await readFile(
      new URL("../fixtures/prematch.json", import.meta.url),
      "utf8",
    ),
  );
test("Blaze independent Nest module: API, health, failure preserves snapshots and disabled prevents HTTP", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blaze-nest-"));
  const settings = {
    ...configuration().settings,
    persistenceMode: "file" as const,
    blazeEnabled: true,
    blazeInboxDir: join(dir, "inbox"),
    dataDir: join(dir, "data"),
    ttlMs: 1e12,
  };
  let fail = false,
    calls = 0;
  const mod = await Test.createTestingModule({ imports: [BlazeModule] })
    .overrideProvider(AppConfiguration)
    .useValue({ settings })
    .overrideProvider(BlazeClient)
    .useValue({
      snapshot: async () => {
        calls++;
        if (fail) throw new ProviderTransportError("blaze", Error("HTTP 403"));
        return fixture();
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
    const service = app.get(BlazeService),
      options = {
        esports: ["cs2", "lol", "valorant"] as ("cs2" | "lol" | "valorant")[],
      };
    await service.collectEvents(options);
    await service.collectEventDetails(
      { provider: "blaze", esport: "cs2", eventId: "2711247139689869329" },
      options,
    );
    const url = await app.getUrl();
    assert.equal((await fetch(url + "/providers/blaze/events")).status, 200);
    assert.equal(
      (await fetch(url + "/providers/blaze/events/2711247139689869329")).status,
      200,
    );
    const health = await (await fetch(url + "/providers/blaze/health")).json();
    assert.equal(health.eventCount, 80);
    assert.equal(health.transport, "http");
    const before = service.readEvents(options.esports);
    fail = true;
    await assert.rejects(() => service.collectEvents(options));
    assert.deepEqual(service.readEvents(options.esports), before);
    settings.blazeEnabled = false;
    const previous = calls;
    await assert.rejects(() => service.collectEvents(options));
    assert.equal(calls, previous);
    settings.ttlMs = 1;
    assert.equal((await fetch(url + "/providers/blaze/events")).status, 503);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("Blaze HTTP client only GET public manifest/shards/descriptions; abort and no replay/browser fallback", async (t) => {
  const c = await fixture(),
    settings = configuration().settings;
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, options?: RequestInit) => {
      calls++;
      assert.equal(options?.redirect, "error");
      assert.equal(options?.headers, undefined);
      const path = String(input);
      const data = path.endsWith("/0")
        ? c.data.manifest
        : path.endsWith("/markets/pt-BR")
          ? c.data.descriptions
          : c.data.shards.find((s) => path.endsWith("/" + s.version))?.data;
      assert.ok(data);
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      });
    },
  );
  const client = new BlazeClient({ settings } as AppConfiguration);
  assert.deepEqual((await client.snapshot()).data, c.data);
  assert.equal(calls, c.data.shards.length + 2);
  t.mock.restoreAll();
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("blocked", { status: 403 }),
  );
  await assert.rejects(() => client.snapshot(), ProviderTransportError);
  t.mock.restoreAll();
  settings.collection.listTimeoutMs = 5;
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
test("Blaze generic scheduler: concurrency, transport backoff, circuit breaker and provider isolation", async () => {
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
    ["blaze", "superbet"],
    async (job) => {
      if (job.provider === "blaze") {
        calls++;
        if (fail) throw new ProviderTransportError("blaze", Error("403"));
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
  assert.equal(scheduler.providers.get("blaze")!.consecutiveFailures, 1);
  assert.ok(scheduler.providers.get("blaze")!.cooldownUntil! > now);
  const before = calls;
  await scheduler.tick();
  await scheduler.drain();
  assert.equal(calls, before);
  assert.equal(scheduler.providers.get("superbet")!.activeJobs, 0);
  now += config.cooldownMs + 1;
  fail = false;
  await scheduler.tick();
  await scheduler.drain();
  assert.equal(scheduler.providers.get("blaze")!.consecutiveFailures, 0);
  assert.equal(scheduler.providers.get("blaze")!.effectiveConcurrency, 1);
  await scheduler.stop();
});

import { AppModule } from "../../../app.module.js";
import { ODDS_PROVIDERS } from "../../collection/provider-registry.js";
import { CollectionService } from "../../collection/collection.service.js";
import { object } from "../types/feed.js";
test("Nest CollectionModule publishes Blaze scheduled list/detail and exposes successful /health without a browser", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blaze-scheduled-"));
  const settings = {
    ...configuration().settings,
    persistenceMode: "file" as const,
    blazeEnabled: true,
    dataDir: join(dir, "data"),
    blazeInboxDir: join(dir, "inbox"),
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
      factory: (service: BlazeService) => [service],
      inject: [BlazeService],
    })
    .overrideProvider(BlazeClient)
    .useValue({
      snapshot: async () => {
        const c = await fixture();
        const now = Date.now();
        c.capturedAt = new Date(now).toISOString();
        for (const s of c.data.shards) {
          const d = object(s.data);
          d.generated = now;
          for (const e of Object.values(object(d.events)))
            object(object(e).desc).scheduled = (now + 7200000) / 1000;
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
    assert.equal(health.providers.blaze.status, "ok");
    assert.ok(health.providers.blaze.lastListSuccessAt);
    assert.equal(health.providers.blaze.activeJobs, 0);
    assert.equal(app.get(BlazeService).store.details.size, 1);
    assert.equal(
      (await fetch((await app.getUrl()) + "/providers/blaze/events")).status,
      200,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
