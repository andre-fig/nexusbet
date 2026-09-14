import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Test } from "@nestjs/testing";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SuperbetModule } from "../superbet.module.js";
import { SuperbetService } from "../superbet.service.js";
import { SuperbetClient } from "../superbet.client.js";
import { Bet365Service } from "../../bet365/bet365.service.js";
import { BetanoService } from "../../betano/betano.service.js";
import { AppModule } from "../../../app.module.js";
import {
  AppConfiguration,
  configuration,
} from "../../../config/configuration.js";
import { configureHttp } from "../../../bootstrap.js";
import { CollectionService } from "../../collection/collection.service.js";
import { ODDS_PROVIDERS } from "../../collection/provider-registry.js";
import {
  StaleDataError,
  ProviderTransportError,
} from "../../../shared/errors/domain-errors.js";
const fixture = async (name: string) =>
  JSON.parse(
    await readFile(
      new URL("../fixtures/" + name + ".json", import.meta.url),
      "utf8",
    ),
  );
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "superbet-nest-"));
  return {
    dir,
    settings: {
      ...configuration().settings,
      esports: ["lol"] as ["lol"],
      dataDir: join(dir, "data"),
      superbetInboxDir: join(dir, "superbet"),
      inboxDir: join(dir, "bet365"),
      detailInboxDir: join(dir, "detail"),
      betanoInboxDir: join(dir, "betano"),
      scanEnabled: false,
      ttlMs: 1e12,
      collection: {
        ...configuration().settings.collection,
        enabled: false,
        startupDelayMs: 0,
        jitterMs: 0,
      },
    },
  };
}
test("Superbet module boots independently, real HTTP controller schema, publication and TTL", async () => {
  const { dir, settings } = await setup();
  let closed = 0;
  const module = await Test.createTestingModule({ imports: [SuperbetModule] })
    .overrideProvider(AppConfiguration)
    .useValue({ settings })
    .overrideProvider(SuperbetClient)
    .useValue({
      structure: () => fixture("structure"),
      list: () => fixture("lol-list"),
      detail: () => fixture("lol-detail"),
      close: async () => {
        closed++;
      },
    })
    .compile();
  const app = configureHttp(
    module.createNestApplication({ logger: false, bodyParser: false }),
  );
  try {
    assert.throws(() => module.get(Bet365Service));
    assert.throws(() => module.get(BetanoService));
    await app.listen(0, "127.0.0.1");
    const service = app.get(SuperbetService);
    const options = { esports: ["lol"] as ["lol"] };
    await service.collectEvents(options);
    await service.collectEventDetails(
      { provider: "superbet", eventId: "14986522", esport: "lol" },
      options,
    );
    const url = await app.getUrl();
    const r = await fetch(url + "/providers/superbet/events?esport=lol");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), service.readEvents(["lol"]));
    const d = await fetch(
      url + "/providers/superbet/events/14986522?esport=lol",
    );
    assert.equal((await d.json()).markets.length, 92);
    settings.ttlMs = 1;
    assert.throws(() => service.readEvents(["lol"]), StaleDataError);
    assert.equal(
      (await fetch(url + "/providers/superbet/events?esport=lol")).status,
      503,
    );
    await service.closeCollection();
    assert.equal(closed, 1);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("real CollectionService schedules Superbet HTTP pipeline and serves third-provider health", async () => {
  const { dir, settings } = await setup();
  const at = Date.now();
  let lists = 0;
  const fresh = async (name: string) => {
    const c = await fixture(name);
    c.capturedAt = new Date().toISOString();
    // Shift only these runtime mocks; historical fixture files remain untouched.
    if (c.data.events)
      for (const e of c.data.events)
        e.fixture.utc_date = new Date(
          Date.now() + (e.event_id === 14986522 ? 1800000 : 7200000),
        ).toISOString();
    if (Array.isArray(c.data.data))
      for (const e of c.data.data)
        e.matchDate = new Date(Date.now() + 1800000).toISOString();
    return c;
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfiguration)
    .useValue({ settings })
    .overrideProvider(SuperbetClient)
    .useValue({
      structure: () => fresh("structure"),
      list: () => {
        lists++;
        return fresh("lol-list");
      },
      detail: () => fresh("lol-detail"),
      close: async () => {},
    })
    .overrideProvider(ODDS_PROVIDERS)
    .useFactory({
      factory: (p: SuperbetService) => [p],
      inject: [SuperbetService],
    })
    .compile();
  const app = configureHttp(
    module.createNestApplication({ logger: false, bodyParser: false }),
  );
  try {
    await app.listen(0, "127.0.0.1");
    const collection = app.get(CollectionService);
    collection.scheduler.start();
    collection.scheduler.tick();
    await collection.scheduler.drain();
    assert.equal(lists, 1);
    assert.ok(collection.scheduler.catalog.size === 10);
    const detail = collection.scheduler.details.get("superbet:14986522")!;
    assert.ok(detail);
    await collection.scheduler.drain();
    collection.scheduler.tick();
    await collection.scheduler.drain();
    const health = await (await fetch((await app.getUrl()) + "/health")).json();
    assert.equal(health.providers.superbet.status, "ok");
    assert.ok(Date.parse(health.providers.superbet.lastListSuccessAt) >= at);
    assert.equal(health.providers.superbet.activeJobs, 0);
    assert.ok(app.get(SuperbetService).store.details.size >= 1);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("HTTP client has no credentials, refuses redirects/private paths, and aborts without retrying protection errors", async () => {
  const { dir, settings } = await setup();
  const original = globalThis.fetch;
  let calls = 0;
  try {
    const client = new SuperbetClient({ settings } as AppConfiguration);
    globalThis.fetch = async (_input, init) => {
      const url = new URL(String(_input));
      assert.equal(Date.parse(url.searchParams.get("startDate")!) % 3600000, 0);
      assert.equal(
        Date.parse(url.searchParams.get("endDate")!) -
          Date.parse(url.searchParams.get("startDate")!),
        180 * 86400000,
      );
      calls++;
      assert.equal(init?.method, "GET");
      assert.equal(init?.headers, undefined);
      assert.equal(init?.redirect, "error");
      return new Response("blocked", { status: 403 });
    };
    await assert.rejects(client.list("lol"), ProviderTransportError);
    assert.equal(calls, 1);
    await assert.rejects(client.get("/account/balance"));
    assert.equal(calls, 1);
    globalThis.fetch = async (_input, init) =>
      new Promise((_r, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    const controller = new AbortController();
    const work = client.list("lol", controller.signal);
    controller.abort(Error("test abort"));
    await assert.rejects(work, /test abort/);
    await client.close();
  } finally {
    globalThis.fetch = original;
    await rm(dir, { recursive: true, force: true });
  }
});
