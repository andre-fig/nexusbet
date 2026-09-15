import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Test } from "@nestjs/testing";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AppModule } from "../../collection/tests/provider-harness.js";
import { configureHttp } from "../../../bootstrap.js";
import {
  AppConfiguration,
  configuration,
} from "../../../config/configuration.js";
import { Bet365Module } from "../../bet365/bet365.module.js";
import { BetanoModule } from "../../betano/betano.module.js";
import { Bet365Service } from "../../bet365/bet365.service.js";
import { BetanoService } from "../../betano/betano.service.js";
const fixture = async (provider: string, name: string) =>
  JSON.parse(
    await readFile(
      new URL(`../../${provider}/fixtures/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "nest-odds-"));
  const settings = {
    ...configuration().settings,
    collection: { ...configuration().settings.collection, enabled: false },
    ingestEnabled: true,
    scanEnabled: false,
    pollingEnabled: false,
    ttlMs: 1e12,
    dataDir: join(dir, "data"),
    estrelabetEnabled: false,
    estrelabetInboxDir: join(dir, "estrelabet"),
    inboxDir: join(dir, "inbox"),
    detailInboxDir: join(dir, "detail"),
    betanoInboxDir: join(dir, "betano"),
    superbetInboxDir: join(dir, "superbet"),
  };
  return { dir, settings };
}
test("Nest HTTP preserves existing schemas, fixtures, detail, matching, TTL and read-only errors", async () => {
  const { dir, settings } = await setup();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfiguration)
    .useValue({ settings })
    .compile();
  const app = configureHttp(
    module.createNestApplication({ logger: false, bodyParser: false }),
  );
  try {
    const a = app.get(Bet365Service),
      b = app.get(BetanoService);
    for (const game of ["cs2", "lol", "valorant"]) {
      await a.store.ingest(
        await fixture("bet365", "details/" + game + "-list"),
      );
      await b.store.ingest(await fixture("betano", game + "-round"));
    }
    const tabs = ["main", "match", "map1", "map2", "map3"];
    await a.details.ingest({
      eventId: "200976787",
      listing: await fixture("bet365", "details/lol-list"),
      captures: await Promise.all(
        tabs.map((t) => fixture("bet365", "details/lol-" + t)),
      ),
      coverage: "all_tabs",
    });
    const d = await fixture("betano", "lol-detail");
    await b.store.ingest({ kind: "detail", esport: "lol", capture: d });
    await app.listen(0, "127.0.0.1");
    const url = await app.getUrl();
    const get = async (path: string) => {
      const r = await fetch(url + path);
      assert.equal(r.headers.get("cache-control"), "no-store");
      return { status: r.status, body: await r.json() };
    };
    const legacy = (await get("/matches")).body;
    assert.equal(legacy.length, a.store.state.matches.length);
    assert.equal(
      legacy[0].markets[0].selections[0].odds,
      a.store.state.matches[0].markets[0].selections[0].odds,
    );
    assert.equal(
      typeof legacy[0].markets[0].selections[0].displayOdds,
      "string",
    );
    assert.deepEqual((await get("/provenance")).body, a.provenance());
    const bet365Events = (await get("/providers/bet365/events")).body;
    const betanoEvents = (await get("/providers/betano/events")).body;
    assert.equal(
      bet365Events.length,
      a.readEvents(["cs2", "lol", "valorant"]).length,
    );
    assert.equal(
      betanoEvents.length,
      b.readEvents(["cs2", "lol", "valorant"]).length,
    );
    assert.equal(
      typeof bet365Events[0].markets[0].selections[0].displayOdds,
      "string",
    );
    assert.equal(
      typeof betanoEvents[0].markets[0].selections[0].displayOdds,
      "string",
    );
    assert.deepEqual(
      (await get("/providers/betano/matches")).body,
      (await get("/providers/betano/events")).body,
    );
    assert.equal((await get("/matches/200976787")).body.markets.length, 24);
    assert.equal(
      (await get("/providers/bet365/events/200976787?esport=lol")).body
        .coverage,
      "all_tabs",
    );
    assert.equal(
      (
        await get("/providers/betano/events/" + d.data.event.id + "?esport=lol")
      ).body.markets.filter(
        (m: { category: string }) => m.category === "map_winner",
      ).length,
      5,
    );
    // Fresh accepted listings enter the current matching read even when ingested directly.
    assert.equal((await get("/comparisons")).status, 200);
    assert.equal((await get("/matching/unmatched")).status, 200);
    assert.equal((await get("/health")).body.provider, "bet365");
    assert.equal(
      (await get("/providers/betano/health")).body.provider,
      "betano",
    );
    assert.equal((await get("/providers/unknown/events")).status, 404);
    assert.equal((await get("/matches?esport=football")).status, 400);
    assert.equal(
      (await fetch(url + "/matches", { method: "POST" })).status,
      405,
    );
    // Disabled local transport must not erase accepted provider snapshots or comparison.
    settings.providerEnabled.bet365 = false;
    settings.providerEnabled.betano = false;
    const beforeA = (await get("/providers/bet365/events")).body;
    const beforeB = (await get("/providers/betano/events")).body;
    await assert.rejects(a.collectEvents({ esports: ["cs2"] }));
    await assert.rejects(b.collectEvents({ esports: ["cs2"] }));
    assert.deepEqual((await get("/providers/bet365/events")).body, beforeA);
    assert.deepEqual((await get("/providers/betano/events")).body, beforeB);
    settings.ttlMs = 1;
    for (const path of [
      "/matches",
      "/matches/200976787",
      "/providers/bet365/events",
      "/providers/betano/events",
      "/comparisons",
    ])
      assert.equal((await get(path)).status, 503, path);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
for (const [own, other] of [
  [Bet365Module, BetanoService],
  [BetanoModule, Bet365Service],
] as const)
  test(`${own.name} boots without the other provider`, async () => {
    const { dir, settings } = await setup();
    const mod = await Test.createTestingModule({ imports: [own] })
      .overrideProvider(AppConfiguration)
      .useValue({ settings })
      .compile();
    try {
      assert.throws(() => mod.get(other));
    } finally {
      await mod.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
test("source boundaries: providers never import each other; shared never imports provider protocol", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  async function files(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((e) =>
          e.isDirectory()
            ? files(join(dir, e.name))
            : Promise.resolve([join(dir, e.name)]),
        ),
      )
    ).flat();
  }
  for (const name of ["bet365", "betano", "shared", "matching"]) {
    const base =
      name === "shared" ? join(root, name) : join(root, "modules", name);
    for (const file of await files(base)) {
      if (!file.endsWith(".ts") || file.includes("/tests/")) continue;
      const source = await readFile(file, "utf8");
      for (const m of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const target = resolve(dirname(file), m[1]);
        if (name === "bet365" || name === "betano")
          assert.ok(
            !target.includes(
              "/modules/" + (name === "bet365" ? "betano" : "bet365") + "/",
            ),
            file,
          );
        else assert.ok(!/\/modules\/(bet365|betano)\//.test(target), file);
      }
    }
  }
});
