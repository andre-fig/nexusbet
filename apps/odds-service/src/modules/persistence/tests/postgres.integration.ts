import "reflect-metadata";
import "dotenv/config";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { ConfigService } from "@nestjs/config";
import {
  AppConfiguration,
  configuration,
} from "../../../config/configuration.js";
import { DatabaseService } from "../../database/database.service.js";
import { seedProviders } from "../../database/seed.js";
import { PersistenceService } from "../persistence.service.js";
import { CatalogRepository } from "../repositories/catalog.repository.js";
import { MatchingRepository } from "../repositories/matching.repository.js";
import { DataIssuesRepository } from "../repositories/issues.repository.js";
import { OddsReadRepository } from "../repositories/read.repository.js";
import type { NormalizedEvent } from "../../../shared/domain/normalized-event.js";
import type { PersistencePublication } from "../../../shared/interfaces/persistence-port.interface.js";
import { sanitize } from "../sanitize.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw Error("Set TEST_DATABASE_URL to a dedicated database ending in _test");
process.env.DATABASE_URL = url;
process.env.PERSISTENCE_MODE = "postgres";
process.env.COLLECTION_ENABLED = "false";
const config = new AppConfiguration(new ConfigService(configuration()));
let database: DatabaseService,
  service: PersistenceService,
  issues: DataIssuesRepository;
const at = "2026-09-15T00:00:00.000Z";
function event(
  provider: NormalizedEvent["provider"] = "superbet",
  odds = 1.72,
  time = at,
  id = "external/string:01",
): NormalizedEvent {
  return {
    provider,
    esport: "cs2",
    eventId: id,
    tournament: "Test League",
    teamA: "Alpha",
    teamB: "Beta",
    rawTeamA: "Alpha",
    rawTeamB: "Beta",
    normalizedTeamA: "alpha",
    normalizedTeamB: "beta",
    startsAt: "2026-09-16T00:00:00.000Z",
    status: "scheduled",
    fetchedAt: time,
    inPlay: false,
    suspended: false,
    provenance: {
      payload: { eventId: id },
      cookies: "must-not-persist",
      headers: { authorization: "must-not-persist" },
    },
    markets: [
      {
        marketId: "market/map:4",
        rawMarketId: "raw-market",
        category: "map_winner",
        name: "Map 4 Winner",
        map: 4,
        line: null,
        groupId: null,
        groupName: null,
        inPlay: false,
        suspended: false,
        raw: {
          payload: JSON.stringify({ id: 3, password: "must-not-persist" }),
        },
        selections: [
          {
            selectionId: "selection:string",
            name: "Alpha",
            odds,
            line: null,
            side: null,
            suspended: false,
            inPlay: false,
            raw: { id: "selection:string" },
          },
        ],
      },
    ],
  };
}
function publication(
  e: NormalizedEvent,
  kind: "list" | "detail" = "list",
): PersistencePublication {
  return {
    provider: e.provider,
    esport: e.esport,
    kind,
    scope: e.provider + ":" + kind + ":" + e.esport,
    fetchedAt: e.fetchedAt,
    events: [e],
    observations: [
      {
        scope: e.provider + ":observation:" + kind,
        complete: true,
        matches: [e],
        fetchedAt: e.fetchedAt,
        source: {
          transport: "http",
          url: "https://example.test/feed",
          method: "GET",
          capture: "direct-http",
          authenticated: false,
        },
      },
    ],
    checkpoint: { key: e.provider + ":test", payload: { events: [e] } },
  };
}
async function connect() {
  database = new DatabaseService(config);
  await database.onModuleInit();
  issues = new DataIssuesRepository(database);
  service = new PersistenceService(
    database,
    new CatalogRepository(issues),
    new MatchingRepository(issues),
  );
  await service.onModuleInit();
}
before(async () => {
  execFileSync(
    "node",
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  await connect();
});
after(async () => {
  await database?.onApplicationShutdown();
});
beforeEach(async () => {
  await database.db.$executeRawUnsafe(
    "TRUNCATE providers, canonical_events, legacy_checkpoints CASCADE",
  );
  await seedProviders(database.db);
});
test("seed is idempotent and provider slug has a database unique constraint", async () => {
  await seedProviders(database.db);
  assert.equal(await database.db.provider.count(), 5);
  await assert.rejects(
    database.db.provider.create({
      data: { slug: "bet365", name: "Duplicate" },
    }),
  );
});
test("upserts preserve external strings, maps, raw IDs and sanitize nested raw data", async () => {
  const p = publication(event());
  await service.commit(p);
  await service.commit(p);
  assert.equal(await database.db.providerEvent.count(), 1);
  assert.equal(await database.db.market.count(), 1);
  assert.equal(await database.db.selection.count(), 1);
  assert.equal(await database.db.oddsSnapshot.count(), 1);
  const m = await database.db.market.findFirstOrThrow({
    include: { selections: true, providerEvent: true },
  });
  assert.equal(m.mapNumber, 4);
  assert.equal(m.rawMarketId, "raw-market");
  assert.equal(m.selections[0].providerSelectionId, "selection:string");
  assert.equal(m.providerEvent.providerEventId, "external/string:01");
  assert.ok(!JSON.stringify(m).includes("must-not-persist"));
});
test("same external event ID belongs independently to different providers; three-way canonical links persist", async () => {
  for (const p of ["bet365", "betano", "superbet"] as const)
    await service.commit(publication(event(p)));
  assert.equal(await database.db.providerEvent.count(), 3);
  assert.equal(await database.db.canonicalEvent.count(), 1);
  const matches = await database.db.eventMatch.findMany();
  assert.equal(matches.length, 3);
  assert.ok(
    matches.every(
      (m) =>
        m.status === "matched" &&
        m.canonicalEventId === matches[0].canonicalEventId,
    ),
  );
  const view = await new OddsReadRepository(database).events();
  assert.equal(view[0].matches.length, 3);
});
test("numeric history 1.72 → 1.70 → 1.68, temporal ordering, current odds and unchanged observations", async () => {
  for (const [i, price] of [1.72, 1.7, 1.68, 1.68].entries())
    await service.commit(
      publication(
        event(
          "superbet",
          price,
          new Date(Date.parse(at) + i * 60000).toISOString(),
        ),
      ),
    );
  const rows = await database.db.oddsSnapshot.findMany({
    orderBy: { fetchedAt: "asc" },
  });
  assert.deepEqual(
    rows.map((r) => r.odds?.toString()),
    ["1.72", "1.7", "1.68", "1.68"],
  );
  assert.equal(await database.db.selection.count(), 1);
  const history = await new OddsReadRepository(database).history(
    rows[0].selectionId,
  );
  assert.equal(history[0].odds?.toString(), "1.68");
  assert.equal(history[0].fetchedAt.toISOString(), "2026-09-15T00:03:00.000Z");
  const changes = (await database.db.publication.findMany()).flatMap(
    (p) => p.changes as { type: string }[],
  );
  assert.equal(changes.filter((c) => c.type === "OddsChanged").length, 2);
});
test("database prevents destructive updates and deletes of historical snapshots", async () => {
  await service.commit(publication(event()));
  const row = await database.db.oddsSnapshot.findFirstOrThrow();
  await assert.rejects(
    database.db.oddsSnapshot.update({
      where: { id: row.id },
      data: { odds: "7.99" },
    }),
  );
  await assert.rejects(
    database.db.oddsSnapshot.delete({ where: { id: row.id } }),
  );
  assert.equal(
    (
      await database.db.oddsSnapshot.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).odds?.toString(),
    "1.72",
  );
});
test("decimal precision is preserved without a floating SQL column", async () => {
  await service.commit(publication(event("superbet", 1.123456789123)));
  const row = await database.db.oddsSnapshot.findFirstOrThrow();
  assert.equal(row.odds?.toString(), "1.123456789123");
});
test("removal retains event/history and never infers finished; failed listing keeps valid scope", async () => {
  const p = publication(event());
  await service.commit(p);
  await assert.rejects(service.commit({ ...p, fetchedAt: "invalid" }));
  assert.equal(
    (await database.db.providerEvent.findFirstOrThrow()).listed,
    true,
  );
  const empty = {
    ...p,
    fetchedAt: "2026-09-15T00:01:00.000Z",
    events: [],
    observations: p.observations.map((b) => ({
      ...b,
      matches: [],
      fetchedAt: "2026-09-15T00:01:00.000Z",
    })),
  };
  await service.commit(empty);
  const row = await database.db.providerEvent.findFirstOrThrow();
  assert.equal(row.listed, false);
  assert.equal(row.providerStatus, "scheduled");
  assert.equal(await database.db.oddsSnapshot.count(), 1);
  const changes = (await database.db.publication.findMany()).flatMap(
    (p) => p.changes as { type: string }[],
  );
  assert.ok(changes.some((c) => c.type === "EventRemoved"));
});
test("one eligible provider is not applicable and creates no unmatched issue", async () => {
  await service.commit(publication(event()));
  assert.equal(await database.db.eventMatch.count(), 0);
  assert.equal(
    await database.db.dataIssue.count({ where: { type: "UNMATCHED_EVENT" } }),
    0,
  );
  assert.equal(
    await database.db.dataIssue.count({ where: { type: "MARKET_INCOMPLETE" } }),
    1,
  );
  await service.commit(publication(event("betano")));
  assert.equal(await database.db.eventMatch.count(), 2);
  assert.ok(
    (await database.db.eventMatch.findMany()).every(
      (match) => match.status === "matched",
    ),
  );
  assert.equal(
    await database.db.dataIssue.count({ where: { type: "UNMATCHED_EVENT" } }),
    0,
  );
  assert.equal(
    await database.db.dataIssue.count({ where: { type: "MARKET_INCOMPLETE" } }),
    2,
  );
});
test("two eligible providers with isolated events create unmatched issues", async () => {
  await service.commit(publication(event()));
  const other = event("betano");
  other.teamA = other.rawTeamA = other.normalizedTeamA = "Gamma";
  await service.commit(publication(other));
  assert.equal(await database.db.eventMatch.count(), 2);
  assert.ok(
    (await database.db.eventMatch.findMany()).every(
      (match) => match.status === "unmatched",
    ),
  );
  assert.equal(
    await database.db.dataIssue.count({
      where: { status: "open", type: "UNMATCHED_EVENT" },
    }),
    2,
  );
});
test("failure after relational writes rolls back snapshots, catalogue, matching and checkpoint", async () => {
  await service.commit(publication(event()));
  const before = await database.db.oddsSnapshot.count();
  class BrokenCatalog extends CatalogRepository {
    override async write(...args: Parameters<CatalogRepository["write"]>) {
      await super.write(...args);
      throw Error("injected failure after writes");
    }
  }
  const broken = new PersistenceService(
    database,
    new BrokenCatalog(issues),
    new MatchingRepository(issues),
  );
  await assert.rejects(
    broken.commit(
      publication(
        event("superbet", 1.68, "2026-09-15T00:01:00Z", "another-id"),
      ),
    ),
  );
  assert.equal(await database.db.oddsSnapshot.count(), before);
  assert.equal(await database.db.providerEvent.count(), 1);
  assert.equal(await database.db.publication.count(), 1);
  assert.equal(
    (await service.restore<{ events: NormalizedEvent[] }>("superbet:test"))
      ?.events[0].eventId,
    "external/string:01",
  );
});
test("restart reconstructs scopes, catalogue, matching, issues and checkpoints without files", async () => {
  await service.commit(publication(event()));
  await service.commit(publication(event("betano")));
  const before = await service.restore("superbet:test");
  const baseline = await service.baselines("superbet");
  const canonical = (await database.db.canonicalEvent.findFirstOrThrow()).id;
  await database.onApplicationShutdown();
  await connect();
  assert.deepEqual(await service.restore("superbet:test"), before);
  assert.deepEqual(await service.baselines("superbet"), baseline);
  assert.equal((await service.baselines("betano")).length, 1);
  assert.equal((await service.catalogEvents()).length, 2);
  assert.equal(
    (await database.db.canonicalEvent.findFirstOrThrow()).id,
    canonical,
  );
  assert.equal(await database.db.oddsSnapshot.count(), 2);
  assert.equal(
    await database.db.dataIssue.count({ where: { type: "UNMATCHED_EVENT" } }),
    0,
  );
  assert.equal(
    await database.db.dataIssue.count({ where: { type: "MARKET_INCOMPLETE" } }),
    2,
  );
});
test("stale retry cannot replace latest projection; conflicting timestamp is rejected atomically", async () => {
  await service.commit(
    publication(event("superbet", 1.68, "2026-09-15T00:01:00Z")),
  );
  await service.commit(publication(event()));
  assert.equal(await database.db.oddsSnapshot.count(), 1);
  await assert.rejects(
    service.commit(publication(event("superbet", 1.9, "2026-09-15T00:01:00Z"))),
  );
  assert.equal(await database.db.oddsSnapshot.count(), 1);
});
test("sanitizer removes secrets in nested JSON, URLs and text while keeping raw identifiers", () => {
  const raw = sanitize({
    ID: "raw-123",
    raw: JSON.stringify({ access_token: "secret-value", FI: "44" }),
    url: "https://user:secret@example.test/feed?token=secret-value&event=7",
    nested: { "Set-Cookie": "secret-value", safe: true },
    password: "secret-value",
  });
  const text = JSON.stringify(raw);
  assert.ok(!text.includes("secret-value"));
  assert.ok(!text.includes("user:"));
  assert.ok(text.includes("raw-123"));
  assert.ok(text.includes("event=7"));
});

// The existing real provider fixtures are consumed unchanged through the original stores.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store as Bet365Store } from "../../bet365/persistence/list.store.js";
import {
  DetailStore,
  type DetailRound,
} from "../../bet365/persistence/detail.store.js";
import { BetanoStore } from "../../betano/persistence/betano.store.js";
import { SuperbetStore } from "../../superbet/persistence/superbet.store.js";
import { MarketJournal, snapshots } from "../../snapshots/market-journal.js";
const fixture = async (provider: string, name: string) =>
  JSON.parse(
    await readFile(
      new URL(`../../${provider}/fixtures/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
for (const provider of ["bet365", "betano", "superbet"] as const)
  test(`${provider}: real fixture stores preserve file results and restore from PostgreSQL with no local state`, async () => {
    const root = await mkdtemp(join(tmpdir(), "odds-pg-equivalence-"));
    try {
      if (provider === "bet365") {
        const file = new Bet365Store(join(root, "file")),
          pg = new Bet365Store(join(root, "pg"), service);
        await file.load();
        await pg.load();
        for (const game of ["cs2", "lol", "valorant"] as const) {
          const data = await fixture(provider, game);
          await file.ingest(data);
          await pg.ingest(data);
        }
        assert.deepEqual(pg.state, file.state);
        const fileDetails = new DetailStore(join(root, "file-details")),
          pgDetails = new DetailStore(
            join(root, "pg-details"),
            new MarketJournal(join(root, "pg-details"), service, "bet365"),
            service,
          );
        await fileDetails.load();
        await pgDetails.load();
        const round: DetailRound = {
          eventId: "200976787",
          listing: await fixture(provider, "details/lol-list"),
          captures: await Promise.all(
            ["main", "match", "map1", "map2", "map3"].map((tab) =>
              fixture(provider, "details/lol-" + tab),
            ),
          ),
          coverage: "all_tabs",
        };
        await fileDetails.ingest(round);
        await pgDetails.ingest(round);
        assert.deepEqual(pgDetails.latest, fileDetails.latest);
        const reloaded = new Bet365Store(join(root, "empty"), service);
        await reloaded.load();
        assert.deepEqual(reloaded.state, file.state);
        const restoredDetails = new DetailStore(
          join(root, "empty-details"),
          new MarketJournal(join(root, "empty-details"), service, "bet365"),
          service,
        );
        await restoredDetails.load();
        assert.deepEqual(restoredDetails.latest, fileDetails.latest);
        const oldJournal = (
          await readFile(
            join(root, "file-details", "market-snapshots.ndjson"),
            "utf8",
          )
        )
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).changes);
        const sqlChanges = (
          await database.db.publication.findFirstOrThrow({
            where: { scope: { kind: "detail" } },
          })
        ).changes;
        assert.deepEqual(sqlChanges, oldJournal.flat());
      } else {
        const create = (path: string, persist = false) =>
          provider === "betano"
            ? new BetanoStore(
                path,
                new MarketJournal(
                  path,
                  persist ? service : undefined,
                  provider,
                ),
                persist ? service : undefined,
              )
            : new SuperbetStore(
                path,
                new MarketJournal(
                  path,
                  persist ? service : undefined,
                  provider,
                ),
                persist ? service : undefined,
              );
        const file = create(join(root, "file")),
          pg = create(join(root, "pg"), true);
        await file.load();
        await pg.load();
        for (const game of ["cs2", "lol", "valorant"] as const) {
          const list =
            provider === "betano"
              ? await fixture(provider, game + "-round")
              : {
                  kind: "listing",
                  esport: game,
                  capture: await fixture(provider, game + "-list"),
                  structure: await fixture(provider, "structure"),
                };
          await file.ingest(list);
          await pg.ingest(list);
          const capture = await fixture(provider, game + "-detail");
          if (file instanceof BetanoStore && pg instanceof BetanoStore) {
            await file.ingest({ kind: "detail", esport: game, capture });
            await pg.ingest({ kind: "detail", esport: game, capture });
          } else if (
            file instanceof SuperbetStore &&
            pg instanceof SuperbetStore
          ) {
            const detail = {
              kind: "detail" as const,
              esport: game,
              eventId: String(capture.data.data[0].eventId),
              capture,
              structure: await fixture(provider, "structure"),
            };
            await file.ingest(detail);
            await pg.ingest(detail);
          }
        }
        assert.deepEqual(pg.listings, file.listings);
        assert.deepEqual(pg.details, file.details);
        const entries = (
          await readFile(join(root, "file", "market-snapshots.ndjson"), "utf8")
        )
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.equal(
          await database.db.oddsSnapshot.count(),
          entries.flatMap((e) => e.snapshots).length,
        );
        const saved = (
          await database.db.publication.findMany({
            orderBy: { createdAt: "asc" },
          })
        ).flatMap((p) => p.changes as object[]);
        assert.deepEqual(
          saved,
          entries.flatMap((e) => e.changes),
        );
        const restored = create(join(root, "empty"), true);
        await restored.load();
        assert.deepEqual(restored.listings, file.listings);
        assert.deepEqual(restored.details, file.details);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test("separate scope timestamps and suspension are retained, baseline restoration avoids invented changes", async () => {
  const first = event();
  first.markets[0].suspended = true;
  first.markets[0].fetchedAt = "2026-09-14T23:59:55.000Z";
  await service.commit(publication(first, "detail"));
  const row = await database.db.oddsSnapshot.findFirstOrThrow();
  assert.equal(row.suspended, true);
  assert.equal(row.fetchedAt.toISOString(), "2026-09-14T23:59:55.000Z");
  const root = await mkdtemp(join(tmpdir(), "odds-pg-baseline-"));
  try {
    const journal = new MarketJournal(root, service, "superbet");
    await journal.load();
    assert.equal(
      await journal.ingest(publication(first, "detail").observations[0]),
      null,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent duplicate publications serialize and do not duplicate snapshots", async () => {
  const p = publication(event());
  await Promise.all([service.commit(p), service.commit(structuredClone(p))]);
  assert.equal(await database.db.publication.count(), 1);
  assert.equal(await database.db.oddsSnapshot.count(), 1);
});
test("canonical identity survives when stale providers make matching not applicable", async () => {
  await service.commit(publication(event()));
  await service.commit(publication(event("betano")));
  const id = (await database.db.canonicalEvent.findFirstOrThrow()).id;
  await service.commit(
    publication(event("superbet", 1.7, "2026-09-15T00:20:00Z")),
  );
  await service.commit(
    publication(event("betano", 1.7, "2026-09-15T00:40:00Z")),
  );
  assert.ok(
    (await database.db.eventMatch.findMany()).every(
      (m) => m.status === "matched" && m.canonicalEventId === id,
    ),
  );
  await service.commit(
    publication(event("superbet", 1.68, "2026-09-15T00:40:01Z")),
  );
  assert.equal(await database.db.canonicalEvent.count(), 1);
  assert.ok(
    (await database.db.eventMatch.findMany()).every(
      (m) => m.canonicalEventId === id,
    ),
  );
});

test("Nest API restores provider state and scheduler catalogue, keeps TTL, validates reads, and disconnects on shutdown", async () => {
  const { Test } = await import("@nestjs/testing");
  const { AppModule } = await import("../../../app.module.js");
  const { configureHttp } = await import("../../../bootstrap.js");
  const { CollectionService } =
    await import("../../collection/collection.service.js");
  const root = await mkdtemp(join(tmpdir(), "odds-pg-nest-"));
  const store = new SuperbetStore(
    join(root, "seed"),
    new MarketJournal(join(root, "seed"), service, "superbet"),
    service,
  );
  await store.load();
  await store.ingest({
    kind: "listing",
    esport: "lol",
    capture: await fixture("superbet", "lol-list"),
    structure: await fixture("superbet", "structure"),
  });
  const testConfig = {
    settings: {
      ...config.settings,
      dataDir: join(root, "empty"),
      inboxDir: join(root, "inbox"),
      detailInboxDir: join(root, "detail"),
      betanoInboxDir: join(root, "betano"),
      superbetInboxDir: join(root, "superbet"),
      blazeInboxDir: join(root, "blaze"),
      estrelabetInboxDir: join(root, "estrelabet"),
      scanEnabled: false,
      ttlMs: 1,
      collection: { ...config.settings.collection, enabled: false },
    },
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfiguration)
    .useValue(testConfig)
    .compile();
  const app = configureHttp(module.createNestApplication({ logger: false }));
  try {
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl();
    const health = await (await fetch(url + "/health")).json();
    assert.equal(health.database.status, "connected");
    assert.equal(app.get(CollectionService).scheduler.catalog.size, 10);
    assert.equal(app.get(CollectionService).scheduler.catalogChanges.size, 0);
    for (const path of ["/providers", "/provider-events", "/events", "/issues"])
      assert.equal((await fetch(url + path)).status, 200);
    assert.equal((await fetch(url + "/events/not-a-uuid")).status, 400);
    assert.equal((await fetch(url + "/issues?status=invalid")).status, 400);
    assert.equal((await fetch(url + "/providers/superbet/events")).status, 503);
    assert.equal(await database.db.providerEvent.count(), 10);
  } finally {
    await app.close();
    assert.equal(app.get(DatabaseService).connected, false);
    await rm(root, { recursive: true, force: true });
  }
});

test("optional legacy importer replays archived captures and resumes without duplicate history", async () => {
  const root = await mkdtemp(join(tmpdir(), "odds-pg-import-"));
  const { mkdir, writeFile } = await import("node:fs/promises");
  try {
    await mkdir(join(root, "inbox"));
    await writeFile(
      join(root, "inbox", "capture.json"),
      JSON.stringify(await fixture("bet365", "lol")),
    );
    const run = (apply: boolean, resume = false) =>
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/modules/persistence/import-legacy.cli.ts",
          "--root",
          root,
          ...(apply ? ["--apply"] : []),
          ...(resume ? ["--resume"] : []),
        ],
        { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
      ).toString();
    assert.ok(run(false).includes("dry-run"));
    assert.equal(await database.db.publication.count(), 0);
    run(true);
    const count = await database.db.oddsSnapshot.count();
    assert.ok(count > 0);
    assert.ok(run(true, true).includes('"newPublications":0'));
    assert.equal(await database.db.oddsSnapshot.count(), count);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("database publication failure leaves provider memory and PostgreSQL history untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "odds-pg-failed-store-"));
  class BrokenCatalog extends CatalogRepository {
    override async write(...args: Parameters<CatalogRepository["write"]>) {
      await super.write(...args);
      throw Error("injected database failure");
    }
  }
  try {
    const store = new SuperbetStore(
      root,
      new MarketJournal(root, service, "superbet"),
      service,
    );
    await store.load();
    const round = {
      kind: "listing" as const,
      esport: "lol" as const,
      capture: await fixture("superbet", "lol-list"),
      structure: await fixture("superbet", "structure"),
    };
    await store.ingest(round);
    const old = new Map(store.listings);
    await assert.rejects(
      readFile(join(root, "market-snapshots.ndjson"), "utf8"),
      { code: "ENOENT" },
    );
    const count = await database.db.oddsSnapshot.count();
    const broken = new PersistenceService(
      database,
      new BrokenCatalog(issues),
      new MatchingRepository(issues),
    );
    const failing = new SuperbetStore(
      root,
      new MarketJournal(root, broken, "superbet"),
      broken,
    );
    await failing.load();
    round.capture.capturedAt = new Date(
      Date.parse(round.capture.capturedAt) + 60000,
    ).toISOString();
    await assert.rejects(failing.ingest(round));
    assert.deepEqual(failing.listings, old);
    await assert.rejects(
      readFile(join(root, "market-snapshots.ndjson"), "utf8"),
      { code: "ENOENT" },
    );
    assert.equal(await database.db.oddsSnapshot.count(), count);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overlapping coverage variants share the original journal baseline and do not manufacture duplicate observations", async () => {
  const root = await mkdtemp(join(tmpdir(), "odds-pg-coverage-"));
  const journal = new MarketJournal(root);
  try {
    await journal.load();
    const observations = [];
    for (const [i, scope, odds] of [
      [0, "all-tabs", 1.72],
      [1, "main-only", 1.7],
      [2, "all-tabs", 1.68],
    ] as const) {
      const p = publication(
        event(
          "bet365",
          odds,
          new Date(Date.parse(at) + i * 60000).toISOString(),
        ),
        "detail",
      );
      p.scope = scope;
      await service.commit(p);
      const entry = await journal.ingest(p.observations[0]);
      observations.push(...entry!.changes);
    }
    const rows = await database.db.publication.findMany({
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      rows.flatMap((r) => r.changes as object[]),
      sanitize(observations),
    );
    assert.equal((await service.baselines("bet365")).length, 1);
    assert.equal(
      (await service.baselines("bet365"))[0].fetchedAt,
      "2026-09-15T00:02:00.000Z",
    );
    const duplicate = publication(
      event("bet365", 1.68, "2026-09-15T00:02:00.000Z"),
      "detail",
    );
    duplicate.scope = "third-coverage";
    await service.commit(duplicate);
    assert.equal(await database.db.oddsSnapshot.count(), 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed database reads expose a typed 503 without driver details and recover on successful read", async () => {
  await assert.rejects(
    database.read(async () => {
      throw Error("private-driver-details");
    }),
    { message: "PostgreSQL read unavailable", status: 503 },
  );
  assert.equal(database.operationFailed, true);
  assert.equal((await new OddsReadRepository(database).providers()).length, 5);
  assert.equal(database.operationFailed, false);
});

import { parseDetail as parseBlazeDetail } from "../../blaze/parsers/feed.parser.js";
test("Blaze real fixture persists maps and IDs, joins canonical peers, restores checkpoint and preserves odds history", async () => {
  const capture = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile(
      new URL("../../blaze/fixtures/prematch.json", import.meta.url),
      "utf8",
    ),
  );
  const e = parseBlazeDetail(capture, "cs2", "2711247139689869329");
  await service.commit(publication(e));
  const count = await database.db.selection.count();
  await service.commit(publication(e));
  assert.equal(await database.db.providerEvent.count(), 1);
  assert.equal(await database.db.selection.count(), count);
  const newer = structuredClone(e);
  newer.fetchedAt = new Date(Date.parse(e.fetchedAt) + 60000).toISOString();
  for (const m of newer.markets) m.fetchedAt = newer.fetchedAt;
  newer.markets.find((m) => m.category === "match_winner")!.selections[0].odds =
    1.68;
  await service.commit(publication(newer));
  for (const provider of ["bet365", "betano", "superbet"] as const)
    await service.commit(publication({ ...structuredClone(newer), provider }));
  assert.equal(await database.db.providerEvent.count(), 4);
  assert.equal(await database.db.canonicalEvent.count(), 1);
  assert.equal(await database.db.eventMatch.count(), 4);
  const history = await database.db.oddsSnapshot.findMany({
    where: {
      selection: {
        providerSelectionId: "4",
        market: {
          providerMarketId: "186",
          providerEvent: { provider: { slug: "blaze" } },
        },
      },
    },
    orderBy: { fetchedAt: "asc" },
  });
  assert.deepEqual(
    history.map((s) => Number(s.odds)),
    [1.7, 1.68],
  );
  assert.ok(await service.restore("blaze:test"));
});

import { parseDetail as parseEstrelaBetDetail } from "../../estrelabet/parsers/feed.parser.js";
test("EstrelaBet real fixture persists maps and IDs, joins canonical peers, restores checkpoint and preserves odds history", async () => {
  const capture = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile(
      new URL("../../estrelabet/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const e = parseEstrelaBetDetail(capture, "cs2", "17707439");
  await service.commit(publication(e));
  const count = await database.db.selection.count();
  await service.commit(publication(e));
  assert.equal(await database.db.providerEvent.count(), 1);
  assert.equal(await database.db.selection.count(), count);
  const newer = structuredClone(e);
  newer.fetchedAt = new Date(Date.parse(e.fetchedAt) + 60000).toISOString();
  for (const m of newer.markets) m.fetchedAt = newer.fetchedAt;
  newer.markets.find((m) => m.category === "match_winner")!.selections[0].odds =
    1.68;
  await service.commit(publication(newer));
  for (const provider of ["bet365", "betano", "superbet", "blaze"] as const)
    await service.commit(publication({ ...structuredClone(newer), provider }));
  assert.equal(await database.db.providerEvent.count(), 5);
  assert.equal(await database.db.canonicalEvent.count(), 1);
  assert.equal(await database.db.eventMatch.count(), 5);
  const history = await database.db.oddsSnapshot.findMany({
    where: {
      selection: {
        providerSelectionId: "4499161413",
        market: {
          providerMarketId: "1732121407",
          providerEvent: { provider: { slug: "estrelabet" } },
        },
      },
    },
    orderBy: { fetchedAt: "asc" },
  });
  assert.deepEqual(
    history.map((s) => Number(s.odds)),
    [1.5264, 1.68],
  );
  assert.ok(await service.restore("estrelabet:test"));
});

test("Monitor reads paginated real groups, current markets, sanitized raw and chronological history without changing matching", async () => {
  const { MonitorRepository } =
    await import("../repositories/monitor.repository.js");
  const { MonitorService } = await import("../../monitor/monitor.service.js");
  const repo = new MonitorRepository(database);
  const collection = {
    operationalHealth: () => ({ providers: { superbet: { status: "ok" } } }),
    providerRuntime: (provider: string) => ({
      active: provider === "superbet",
      status: provider === "superbet" ? "active" : "disabled",
      reason: provider === "superbet" ? "active" : "disabled_in_runtime",
    }),
    activeProviderNames: () => ["superbet"],
    matchingEligibleProviders: () => ({ cs2: ["superbet"] }),
  } as unknown as import("../../collection/collection.service.js").CollectionService;
  const monitorConfig = {
    settings: { ...config.settings, ttlMs: 24 * 60 * 60 * 1000 },
  } as AppConfiguration;
  const monitor = new MonitorService(repo, monitorConfig, collection);
  const e = event();
  e.markets[0].category = "match_winner";
  e.markets[0].map = null;
  for (const [index, odds] of [1.72, 1.7, 1.68].entries()) {
    const next = structuredClone(e);
    next.fetchedAt = new Date(Date.parse(at) + index * 1000).toISOString();
    next.markets[0].selections[0].odds = odds;
    await service.commit(publication(next));
  }
  const result = await monitor.events({ provider: "superbet", limit: "1" });
  assert.equal(result.pagination.total, 1);
  const id = result.items[0].id;
  assert.equal(result.items[0].canonicalId, null);
  assert.equal(result.items[0].providers[0].matchWinner.teamA, null);
  assert.equal(result.items[0].providers[0].matchWinner.status, "incomplete");
  const detail = await monitor.detail(id);
  assert.equal(detail.markets.length, 1);
  assert.equal(detail.markets[0].selections[0].odds, 1.68);
  assert.equal(detail.markets[0].selections[0].displayOdds, "1,68");
  const history = await monitor.history(id, {
    selection: detail.markets[0].selections[0].id,
  });
  assert.deepEqual(
    history.series[0].points.map((p) => p.odds),
    [1.72, 1.7, 1.68],
  );
  assert.deepEqual(
    history.series[0].points.map((p) => p.displayOdds),
    ["1,72", "1,70", "1,68"],
  );
  assert.ok(
    !JSON.stringify(await monitor.raw(id)).includes("must-not-persist"),
  );
  assert.equal(
    (await monitor.events({ search: "does not exist" })).items.length,
    0,
  );
  assert.equal(
    (await monitor.events({ attentionOnly: "true" })).pagination.total,
    1,
  );
  assert.equal(
    (await monitor.issues({ eventId: id })).items[0].type,
    "MARKET_INCOMPLETE",
  );
  const overview = await monitor.overview();
  assert.equal(overview.health.unmatched, 0);
  assert.equal(overview.health.notApplicable, 1);
  await database.db.provider.create({ data: { slug: "sixth", name: "Sixth" } });
  assert.equal((await monitor.providers()).length, 6);
  const removed = structuredClone(e);
  removed.fetchedAt = new Date(Date.parse(at) + 3000).toISOString();
  removed.markets = [];
  await service.commit(publication(removed));
  assert.equal((await monitor.detail(id)).markets.length, 0);
  assert.equal((await monitor.history(id, {})).series[0].points.length, 3);
});
test("one match-winner odd opens a warning and a complete observation resolves it", async () => {
  const first = event();
  first.markets[0].category = "match_winner";
  first.markets[0].map = null;
  await service.commit(publication(first));
  const issue = await database.db.dataIssue.findFirstOrThrow({
    where: { type: "MARKET_INCOMPLETE" },
  });
  assert.equal(issue.severity, "warning");
  assert.equal(issue.status, "open");
  assert.equal(issue.message, "Expected 2 valid selections, found 1");
  assert.ok(issue.marketId);
  const complete = structuredClone(first);
  complete.fetchedAt = new Date(
    Date.parse(first.fetchedAt) + 1000,
  ).toISOString();
  complete.markets[0].selections.push({
    ...structuredClone(complete.markets[0].selections[0]),
    selectionId: "selection:beta",
    name: "Beta",
    odds: 1.95,
  });
  await service.commit(publication(complete));
  assert.equal(
    (await database.db.dataIssue.findUniqueOrThrow({ where: { id: issue.id } }))
      .status,
    "resolved",
  );
});
test("Monitor API compares only current matched provider markets and leaves odds history unchanged", async () => {
  const { MonitorRepository } =
    await import("../repositories/monitor.repository.js");
  const { MonitorService } = await import("../../monitor/monitor.service.js");
  const observations = [
    ["superbet", 2.2, 1.85],
    ["blaze", 2.05, 2.1],
    ["estrelabet", 1.7, 1.95],
    ["betano", 5, 5],
  ] as const;
  const observedAt = new Date().toISOString();
  for (const [name, oddA, oddB] of observations) {
    const e = event(name, oddA, observedAt);
    e.markets[0].category = "match_winner";
    e.markets[0].map = null;
    e.markets[0].selections.push({
      ...structuredClone(e.markets[0].selections[0]),
      selectionId: `${name}:beta`,
      name: "Beta",
      odds: oddB,
    });
    await service.commit(publication(e));
  }
  const collection = {
    operationalHealth: () => ({ providers: {} }),
    providerRuntime: (name: string) => ({
      active: name !== "betano",
      status: name !== "betano" ? "active" : "disabled",
      reason: name !== "betano" ? "active" : "disabled_in_runtime",
    }),
  } as unknown as import("../../collection/collection.service.js").CollectionService;
  const monitor = new MonitorService(
    new MonitorRepository(database),
    config,
    collection,
  );
  const page = await monitor.events({ limit: "1" });
  assert.equal(page.items[0].canonicalId !== null, true);
  assert.equal(page.items[0].analytics.length, 1);
  const analysis = page.items[0].analytics[0];
  assert.equal(analysis.bestPrices[0].provider, "superbet");
  assert.match(
    analysis.bestPrices[0].tooltip,
    /Best price available for this selection/,
  );
  assert.equal(analysis.bestPrices[1].provider, "blaze");
  assert.deepEqual(
    analysis.outliers.map((x) => x.provider),
    ["estrelabet"],
  );
  assert.equal(analysis.arbitrage?.marginPercent, 7.44);
  assert.match(
    analysis.arbitrage?.tooltip ?? "",
    /Estimated theoretical edge \+7\.44%/,
  );
  assert.equal(analysis.arbitrage?.displayMarginPercent, "7,44%");
  const detail = await monitor.detail(page.items[0].id);
  assert.equal(detail.markets.filter((m) => m.analytics !== null).length, 3);
  assert.equal(
    detail.markets.find((m) => m.provider === "betano")?.analytics,
    null,
  );
  assert.equal(await database.db.oddsSnapshot.count(), 8);
  assert.equal(
    await database.db.dataIssue.count({ where: { type: "OUTLIER" } }),
    0,
  );
});
test("market quality separates missing map, observed incomplete map and expired market without using their odds", async () => {
  const { MonitorRepository } =
    await import("../repositories/monitor.repository.js");
  const { MonitorService } = await import("../../monitor/monitor.service.js");
  const observedAt = new Date().toISOString();
  const old = new Date(Date.now() - 15 * 60 * 1000);
  const winner = (
    e: NormalizedEvent,
    category: string,
    map: number | null,
    complete: boolean,
  ) => {
    const m = structuredClone(e.markets[0]);
    m.marketId = `${category}:${map ?? "match"}`;
    m.category = category;
    m.map = map;
    m.selections[0].selectionId = "alpha";
    if (complete)
      m.selections.push({
        ...structuredClone(m.selections[0]),
        selectionId: "beta",
        name: "Beta",
        odds: 2.1,
      });
    return m;
  };
  for (const name of ["superbet", "blaze"] as const) {
    const e = event(name, 2.2, observedAt);
    e.markets = [
      winner(e, "match_winner", null, true),
      winner(e, "map_winner", 1, true),
      winner(e, "map_winner", 2, name === "blaze"),
      ...(name === "blaze" ? [winner(e, "map_winner", 3, true)] : []),
    ];
    if (name === "blaze") e.markets[1].fetchedAt = old.toISOString();
    await service.commit(publication(e));
  }
  const incomplete = await database.db.dataIssue.findMany({
    where: { type: "MARKET_INCOMPLETE", status: "open" },
  });
  assert.equal(incomplete.length, 1);
  assert.equal(incomplete[0].severity, "warning");
  assert.equal(incomplete[0].message, "Expected 2 valid selections, found 1");
  const collection = {
    operationalHealth: () => ({ providers: {} }),
    providerRuntime: () => ({
      active: true,
      status: "active",
      reason: "active",
    }),
  } as unknown as import("../../collection/collection.service.js").CollectionService;
  const monitor = new MonitorService(
    new MonitorRepository(database),
    config,
    collection,
  );
  const page = await monitor.events({ attentionOnly: "true", limit: "1" });
  assert.equal(page.pagination.total, 1);
  assert.deepEqual(
    page.items[0].analytics.map((a) => [a.category, a.mapNumber]),
    [["match_winner", null]],
  );
  const detail = await monitor.detail(page.items[0].id);
  const superbet = detail.providers.find((p) => p.provider === "superbet")!;
  assert.equal(superbet.marketAvailability.map3Winner, "unavailable");
  assert.equal(superbet.marketAvailability.map1Winner, "healthy");
  assert.equal(superbet.marketAvailability.map2Winner, "incomplete");
  const stale = detail.markets.find(
    (m) => m.provider === "blaze" && m.mapNumber === 1,
  )!;
  assert.equal(stale.status, "stale");
  assert.equal(stale.selections[0].displayOdds, "2,20");
  assert.equal(stale.selections[0].status, "stale");
  assert.equal(stale.analytics, null);
  assert.deepEqual(
    (await monitor.issues({ eventId: detail.id })).items
      .map((i) => i.type)
      .sort(),
    ["MARKET_INCOMPLETE", "STALE"],
  );
  assert.equal((await monitor.overview()).health.issues, 2);
  assert.equal(
    await database.db.dataIssue.count({ where: { type: "STALE" } }),
    0,
  );
  const refreshed = event(
    "superbet",
    2.2,
    new Date(Date.now() + 1000).toISOString(),
  );
  refreshed.markets = [
    winner(refreshed, "match_winner", null, true),
    winner(refreshed, "map_winner", 1, true),
    winner(refreshed, "map_winner", 2, true),
  ];
  await service.commit(publication(refreshed));
  assert.equal(
    (
      await database.db.dataIssue.findUniqueOrThrow({
        where: { id: incomplete[0].id },
      })
    ).status,
    "resolved",
  );
  const onlyStale = await monitor.events({ attentionOnly: "true", limit: "1" });
  assert.equal(onlyStale.pagination.total, 1);
  assert.deepEqual(
    onlyStale.items[0].analytics
      .map((a) => [a.category, a.mapNumber])
      .sort((a, b) => String(a).localeCompare(String(b))),
    [
      ["map_winner", 2],
      ["match_winner", null],
    ],
  );
  assert.equal((await monitor.overview()).health.issues, 1);
});
test("Monitor Data Health stays healthy for local issues and exposes systemic warning and critical impact", async () => {
  const { MonitorRepository } =
    await import("../repositories/monitor.repository.js");
  const { MonitorService } = await import("../../monitor/monitor.service.js");
  const now = new Date();
  for (const name of ["superbet", "blaze"] as const)
    await service.commit(publication(event(name, 1.72, now.toISOString())));
  const collection = {
    operationalHealth: () => ({ providers: {} }),
    providerRuntime: (name: string) => ({
      active: name === "superbet" || name === "blaze",
      status: "active",
      reason: "active",
    }),
  } as unknown as import("../../collection/collection.service.js").CollectionService;
  const monitor = new MonitorService(
    new MonitorRepository(database),
    config,
    collection,
  );
  let overview = await monitor.overview();
  assert.equal(overview.health.status, "healthy");
  assert.equal(overview.health.issues, 2);
  const local = (await monitor.issues({ type: "MARKET_INCOMPLETE" })).items;
  assert.equal(local.length, 2);
  assert.ok(
    local.every((issue) => issue.scope === "event" && issue.systemic === false),
  );
  const page = await monitor.events({ attentionOnly: "true", limit: "1" });
  assert.equal(page.pagination.total, 1);
  assert.equal(page.items[0].issues.length, 2);
  await database.db.dataIssue.create({
    data: {
      dedupeKey: "systemic-parser-warning",
      type: "PARSER_FAILURE",
      severity: "warning",
      message: "Parser coverage degraded across providers",
      details: { scope: "system", systemic: true },
      detectedAt: now,
    },
  });
  overview = await monitor.overview();
  assert.equal(overview.health.status, "degraded");
  assert.ok(
    overview.health.reasons.some((reason) =>
      reason.includes("systemic warning"),
    ),
  );
  assert.deepEqual(
    (await monitor.issues({ type: "PARSER_FAILURE" })).items.map((issue) => [
      issue.scope,
      issue.systemic,
    ]),
    [["system", true]],
  );
  await database.db.dataIssue.create({
    data: {
      dedupeKey: "systemic-global-critical",
      type: "COLLECTION_GLOBAL_FAILURE",
      severity: "critical",
      message: "All collection pipelines failed",
      details: { scope: "system", systemic: true },
      detectedAt: now,
    },
  });
  overview = await monitor.overview();
  assert.equal(overview.health.status, "critical");
  assert.equal(overview.health.issues, 4);
});
test("Monitor publication notices occur after commit, never on replay or transaction failure", async () => {
  const { PersistenceNotifications } =
    await import("../persistence-notifications.js");
  const bus = new PersistenceNotifications();
  const notices: unknown[] = [];
  let memoryPublished = false;
  bus.committed.subscribe((n) => {
    assert.equal(memoryPublished, true);
    notices.push(n);
  });
  const publishing = new PersistenceService(
    database,
    new CatalogRepository(issues),
    new MatchingRepository(issues),
    bus,
  );
  const p = publication(event());
  await publishing.commit(p, () => {
    memoryPublished = true;
  });
  assert.equal(notices.length, 1);
  assert.equal(await database.db.oddsSnapshot.count(), 1);
  await publishing.commit(p);
  assert.equal(notices.length, 1);
  const conflict = structuredClone(p);
  conflict.events[0].markets[0].selections[0].odds = 1.1;
  let rollbackPublished = false;
  await assert.rejects(
    publishing.commit(conflict, () => {
      rollbackPublished = true;
    }),
  );
  assert.equal(rollbackPublished, false);
  assert.equal(notices.length, 1);
});

test("Monitor coverage counts only runtime-active providers while retaining disabled feeds", async () => {
  const { MonitorRepository } =
    await import("../repositories/monitor.repository.js");
  const { MonitorService } = await import("../../monitor/monitor.service.js");
  const active = new Set(["superbet", "blaze", "estrelabet"]);
  const collection = {
    operationalHealth: () => ({
      providers: Object.fromEntries(
        ["bet365", "betano", ...active].map((provider) => [
          provider,
          { status: active.has(provider) ? "ok" : "disabled" },
        ]),
      ),
    }),
    providerRuntime: (provider: string) => ({
      active: active.has(provider),
      status: active.has(provider) ? "active" : "disabled",
      reason: active.has(provider) ? "active" : "disabled_in_runtime",
    }),
    activeProviderNames: () => [...active],
    matchingEligibleProviders: () => ({ cs2: [...active] }),
  } as unknown as import("../../collection/collection.service.js").CollectionService;
  const monitor = new MonitorService(
    new MonitorRepository(database),
    {
      settings: { ...config.settings, ttlMs: 24 * 60 * 60 * 1000 },
    } as AppConfiguration,
    collection,
  );
  const base = event();
  for (const provider of ["bet365", "betano", "superbet", "blaze"] as const)
    await service.commit(publication({ ...structuredClone(base), provider }));
  let result = await monitor.events({ limit: "1" });
  assert.equal(result.items[0].matching.providerCount, 2);
  assert.equal(result.items[0].matching.expectedProviderCount, 3);
  assert.equal(result.items[0].matching.status, "partial");
  assert.equal(result.items[0].providers.length, 4);
  const providers = await monitor.providers();
  assert.deepEqual(
    providers
      .filter((provider) => provider.active)
      .map((provider) => provider.id)
      .sort(),
    ["blaze", "estrelabet", "superbet"],
  );
  assert.deepEqual(
    providers
      .filter((provider) => !provider.active)
      .map((provider) => [provider.id, provider.status, provider.statusReason]),
    [
      ["bet365", "disabled", "disabled_in_runtime"],
      ["betano", "disabled", "disabled_in_runtime"],
    ],
  );
  let overview = await monitor.overview();
  assert.equal(overview.health.matched, 0);
  assert.equal(overview.health.partial, 1);
  await service.commit(
    publication({ ...structuredClone(base), provider: "estrelabet" }),
  );
  result = await monitor.events({ limit: "1" });
  assert.equal(result.items[0].matching.providerCount, 3);
  assert.equal(result.items[0].matching.status, "matched");
  const staleMonitor = new MonitorService(
    new MonitorRepository(database),
    { settings: { ...config.settings, ttlMs: 1 } } as AppConfiguration,
    collection,
  );
  const staleResult = await staleMonitor.events({ limit: "1" });
  assert.equal(staleResult.items[0].matching.expectedProviderCount, 3);
  assert.equal(staleResult.items[0].matching.providerCount, 3);
  overview = await monitor.overview();
  assert.equal(overview.health.matched, 1);
  assert.equal(overview.health.partial, 0);
  await database.db.eventMatch.updateMany({
    data: { status: "low_confidence", confidence: 0.4 },
  });
  result = await monitor.events({ limit: "1" });
  assert.equal(result.items[0].matching.status, "low_confidence");
});
