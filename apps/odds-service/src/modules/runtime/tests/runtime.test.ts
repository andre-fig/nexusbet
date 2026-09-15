import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toWire, fromWire } from "../wire-payload.js";
import { providers } from "../runtime-settings.js";
import type { PersistencePublication } from "../../../shared/interfaces/persistence-port.interface.js";
export function sample(
  provider: (typeof providers)[number] = "superbet",
): PersistencePublication {
  const at = new Date().toISOString();
  const event = {
    provider,
    esport: "cs2" as const,
    eventId: "external:01",
    teamA: "Alpha",
    teamB: "Beta",
    rawTeamA: "Alpha",
    rawTeamB: "Beta",
    normalizedTeamA: "alpha",
    normalizedTeamB: "beta",
    tournament: "League",
    startsAt: new Date(Date.now() + 3600000).toISOString(),
    status: "scheduled" as const,
    fetchedAt: at,
    inPlay: false,
    suspended: false,
    provenance: { cookies: "secret" },
    markets: [
      {
        marketId: "winner",
        rawMarketId: "1",
        category: "match_winner",
        name: "Winner",
        map: null,
        line: null,
        groupId: null,
        groupName: null,
        inPlay: false,
        suspended: false,
        raw: { token: "secret" },
        selections: [
          {
            selectionId: "a",
            name: "Alpha",
            odds: 1.923456789123,
            line: null,
            side: null,
            inPlay: false,
            suspended: false,
            raw: {},
          },
          {
            selectionId: "b",
            name: "Beta",
            odds: null,
            line: null,
            side: null,
            inPlay: false,
            suspended: true,
            raw: {},
          },
        ],
      },
    ],
  };
  return {
    provider,
    esport: "cs2",
    kind: "list",
    scope: `${provider}:list:cs2`,
    fetchedAt: at,
    events: [event],
    observations: [
      {
        scope: `${provider}:list:cs2`,
        complete: true,
        matches: [event],
        fetchedAt: at,
        source: {
          transport: "http",
          url: "https://example.test/?token=secret",
          method: "GET",
          capture: "direct-http",
          authenticated: false,
        },
      },
    ],
    checkpoint: { key: "private-state", payload: { password: "secret" } },
  };
}
test("wire payload preserves five provider domains and scopes but excludes secrets", () => {
  for (const p of providers) {
    const wire = toWire(sample(p));
    const accepted = fromWire(wire, p);
    assert.ok(!JSON.stringify(wire).includes("secret"));
    assert.equal(accepted.events[0].eventId, "external:01");
    assert.equal(
      accepted.events[0].markets[0].selections[0].odds,
      1.923456789123,
    );
    assert.equal(accepted.events[0].markets[0].selections[1].odds, null);
    assert.equal(accepted.observations[0].scope, wire.scope);
    assert.throws(() => fromWire({ ...wire, provider: "bad" }, p));
    assert.throws(() =>
      fromWire(
        {
          ...wire,
          events: [{ ...wire.events[0], provenance: { cookies: "x" } }],
        },
        p,
      ),
    );
    assert.throws(() =>
      fromWire(
        {
          ...wire,
          observations: [{ ...wire.observations[0], complete: false }],
        },
        p,
      ),
    );
  }
});
test("agent DI initializes five providers without database, monitor, public HTTP or matching", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-isolation-"));
  try {
    const script = `
 import "reflect-metadata";
 import assert from "node:assert/strict";
 const heartbeats=[];
 globalThis.fetch=async(url,init)=>{heartbeats.push({url,body:JSON.parse(init.body)});return new Response("{}",{status:200});};
 const {NestFactory}=await import("@nestjs/core");
 const {CollectionModule}=await import("./src/modules/collection/collection.module.ts");
 const {ProviderRegistry}=await import("./src/modules/collection/provider-registry.ts");
 const app=await NestFactory.createApplicationContext(CollectionModule,{logger:false});
 try {
 assert.deepEqual(app.get(ProviderRegistry).providers.map(p=>p.name),["bet365","betano","superbet","blaze","estrelabet"]);
 const names=[...app.container.getModules().values()].map(m=>m.metatype.name);
 for(const n of ["DatabaseModule","MonitorModule","MatchingModule"])assert.ok(!names.includes(n));
 assert.equal(typeof app.listen,"undefined");
 assert.equal(heartbeats[0].url,"http://127.0.0.1:1/internal/agents/heartbeat");
 assert.equal(heartbeats[0].body.providers.length,5);
 }finally{await app.close();}
 `;
    await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ODDS_RUNTIME: "collector-agent",
          COLLECTION_ENABLED: "false",
          PERSISTENCE_MODE: "postgres",
          DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/never",
          ODDS_SERVER_URL: "http://127.0.0.1:1",
          ODDS_INGESTION_TOKEN: "x".repeat(40),
          AGENT_ID: "test",
          ODDS_OUTBOX_DIR: dir,
        },
        timeout: 15000,
      },
    );
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("outbox retains failed delivery, backs off, survives restart and bounds capacity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-outbox-"));
  const saved = { ...process.env };
  const original = globalThis.fetch;
  Object.assign(process.env, {
    ODDS_SERVER_URL: "http://127.0.0.1:1",
    ODDS_INGESTION_TOKEN: "x".repeat(40),
    AGENT_ID: "test",
    ODDS_OUTBOX_DIR: dir,
  });
  const { RemotePersistence } = await import("../remote-persistence.js");
  let calls = 0;
  let delivered: unknown;
  globalThis.fetch = async (_url, init) => {
    calls++;
    delivered = JSON.parse(String(init?.body));
    return new Response("{}", { status: 503 });
  };
  const remote = new RemotePersistence();
  try {
    await remote.onModuleInit();
    await remote.commit(sample());
    remote.tick();
    await remote.onModuleDestroy(); // stop can precede send; explicitly restart a fresh instance below
    const retry = new RemotePersistence();
    await retry.onModuleInit();
    retry.tick();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls, 1);
    retry.tick();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls, 1);
    assert.equal((await readdir(dir)).length, 1);
    await retry.onModuleDestroy();
    globalThis.fetch = async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), delivered);
      return new Response("{}", { status: 201 });
    };
    const restarted = new RemotePersistence();
    await restarted.onModuleInit();
    restarted.tick();
    await new Promise((r) => setTimeout(r, 50));
    await restarted.onModuleDestroy();
    assert.equal((await readdir(dir)).length, 0);
    process.env.ODDS_OUTBOX_MAX_BYTES = "1";
    const full = new RemotePersistence();
    await assert.rejects(full.commit(sample()), /outbox full/);
    await full.onModuleDestroy();
  } finally {
    globalThis.fetch = original;
    process.env = saved;
    await remote.onModuleDestroy();
    await rm(dir, { recursive: true, force: true });
  }
});

test("real provider fixtures pass normalized wire validation", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixture = async (p: string, n: string) =>
    JSON.parse(
      await readFile(
        new URL(`../../${p}/fixtures/${n}.json`, import.meta.url),
        "utf8",
      ),
    );
  const { parseDetail: betano } =
    await import("../../betano/parsers/feed.parser.js");
  const { parseDetail: superbet } =
    await import("../../superbet/parsers/feed.parser.js");
  const { parseDetail: blaze } =
    await import("../../blaze/parsers/feed.parser.js");
  const { parseDetail: estrela } =
    await import("../../estrelabet/parsers/feed.parser.js");
  const { parseCapture } = await import("../../bet365/parsers/list.parser.js");
  const bet365 = await import("../../bet365/persistence/list.store.js");
  const { MarketJournal } = await import("../../snapshots/market-journal.js");
  const port = {
    enabled: true,
    baselines: async () => [],
    restore: async <T>() => undefined as T | undefined,
    commit: async (
      p: PersistencePublication,
      after?: () => Promise<void> | void,
    ) => {
      fromWire(toWire(p), p.provider);
      await after?.();
    },
  };
  // Bet365 list normalization belongs to its store, which converts Parsed to domain.
  const root = await mkdtemp(join(tmpdir(), "wire-fixtures-"));
  try {
    const store = new bet365.Store(root, port);
    await store.ingest(await fixture("bet365", "lol"));
    const sb = await fixture("superbet", "lol-detail");
    const es = await fixture("estrelabet", "cs2");
    const events = [
      betano(
        await fixture("betano", "lol-detail"),
        "lol",
        String((await fixture("betano", "lol-detail")).data.event.id),
      ),
      superbet(
        sb,
        "lol",
        String(sb.data.data[0].eventId),
        await fixture("superbet", "structure"),
      ),
      blaze(await fixture("blaze", "prematch"), "cs2", "2711247139689869329"),
      estrela(es, "cs2", String(es.data.detail.id)),
    ];
    for (const e of events) {
      const p = sample(e.provider);
      p.esport = e.esport;
      p.fetchedAt = e.fetchedAt;
      p.events = [e];
      p.observations[0].matches = [e];
      p.observations[0].fetchedAt = e.fetchedAt;
      fromWire(toWire(p), e.provider);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
