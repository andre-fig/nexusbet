import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Test } from "@nestjs/testing";
import { access, mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppModule } from "../../collection/tests/provider-harness.js";
import { configureHttp } from "../../../bootstrap.js";
import {
  AppConfiguration,
  configuration,
} from "../../../config/configuration.js";
import { Bet365Collector } from "../../bet365/bet365.collector.js";
import { SuperbetCollector } from "../../superbet/superbet.collector.js";
import { BetanoCollector } from "../../betano/betano.collector.js";
import { parseCapture } from "../../bet365/parsers/list.parser.js";
import { normalizedBet365 } from "../../bet365/mappers/bet365.mapper.js";
import { normalizeListingRound } from "../../betano/persistence/betano.store.js";
import { publishCapture } from "../../../shared/utils/collection-operation.js";
import type { CollectOptions } from "../../../shared/interfaces/odds-provider.interface.js";
import { CollectionService } from "../collection.service.js";
test("Nest lifecycle starts both providers immediately; health, journals and graceful close use real stores", async (t) => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: "darwin" });
  t.after(() => Object.defineProperty(process, "platform", platform));
  const dir = await mkdtemp(join(tmpdir(), "scheduler-nest-"));
  const settings = {
    ...configuration().settings,
    browser: {
      ...configuration().settings.browser,
      runtime: "local-cdp" as const,
    },
    providerEnabled: { bet365: true, betano: true },
    esports: ["cs2"] as const,
    ingestEnabled: true,
    blazeEnabled: false,
    scanEnabled: false,
    ttlMs: 1e12,
    dataDir: join(dir, "data"),
    estrelabetEnabled: false,
    estrelabetInboxDir: join(dir, "estrelabet"),
    inboxDir: join(dir, "inbox"),
    detailInboxDir: join(dir, "details"),
    betanoInboxDir: join(dir, "betano"),
    superbetInboxDir: join(dir, "superbet"),
    collection: {
      ...configuration().settings.collection,
      enabled: true,
      startupDelayMs: 0,
      jitterMs: 0,
      tickMs: 10000,
    },
  };
  const a = JSON.parse(
      await readFile(
        new URL("../../bet365/fixtures/cs2.json", import.meta.url),
        "utf8",
      ),
    ),
    p = parseCapture(a),
    events = normalizedBet365(p.matches, p.provenance);
  const b = JSON.parse(
    await readFile(
      new URL("../../betano/fixtures/cs2-round.json", import.meta.url),
      "utf8",
    ),
  );
  let closes = 0;
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfiguration)
    .useValue({ settings })
    .overrideProvider(Bet365Collector)
    .useValue({
      collectEvents: async (options: CollectOptions) => {
        await publishCapture(options, a);
        return events;
      },
      close: async () => {
        closes++;
      },
      recordFailure: async () => {},
    })
    .overrideProvider(BetanoCollector)
    .useValue({
      collectEvents: async (options: CollectOptions) => {
        await publishCapture(options, b);
        return normalizeListingRound(b).matches;
      },
      close: async () => {
        closes++;
      },
      recordFailure: async () => {},
    })
    .overrideProvider(SuperbetCollector)
    .useValue({
      collectEvents: async () => {
        throw Error("Mock unavailable");
      },
      close: async () => {},
    })
    .compile();
  const app = configureHttp(
    module.createNestApplication({ logger: false, bodyParser: false }),
  );
  try {
    await app.listen(0, "127.0.0.1");
    const collection = app.get(CollectionService);
    await collection.scheduler.drain();
    const r = await fetch((await app.getUrl()) + "/health");
    const health = await r.json();
    assert.equal(r.status, 200);
    assert.equal(health.scheduler.running, true);
    for (const name of ["bet365", "betano"]) {
      assert.equal(health.providers[name].status, "ok");
      assert.ok(health.providers[name].lastListSuccessAt);
    }
    assert.equal(health.scheduler.activeJobs, 0);
    const aJournal = await readFile(
      join(settings.dataDir, "snapshots.ndjson"),
      "utf8",
    );
    const bJournal = await readFile(
      join(settings.dataDir, "betano", "market-snapshots.ndjson"),
      "utf8",
    );
    assert.match(aJournal, /EventAdded/);
    assert.match(bJournal, /EventAdded/);
    await assert.rejects(access(settings.inboxDir));
    await assert.rejects(access(settings.detailInboxDir));
    await assert.rejects(access(settings.betanoInboxDir));
    assert.equal(collection.scheduler.catalog.size, events.length + 50);
  } finally {
    await app.close();
    assert.ok(closes >= 2);
    await rm(dir, { recursive: true, force: true });
  }
});
