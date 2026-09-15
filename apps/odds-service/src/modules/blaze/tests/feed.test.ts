import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseListing, parseDetail } from "../parsers/feed.parser.js";
import { object, type BlazeCapture } from "../types/feed.js";
import { BlazeStore } from "../persistence/blaze.store.js";
import { MarketJournal } from "../../snapshots/market-journal.js";
import { compareAllProviders } from "../../matching/matching.js";
export const fixture = async (): Promise<BlazeCapture> =>
  JSON.parse(
    await readFile(
      new URL("../fixtures/prematch.json", import.meta.url),
      "utf8",
    ),
  );
const ids = {
  cs2: "2711247139689869329",
  lol: "2711275523589419016",
  valorant: "2711322363403833387",
};
for (const esport of ["cs2", "lol", "valorant"] as const)
  test(`Blaze real ${esport}: listing/detail, IDs, numeric match/map odds and unknown markets`, async () => {
    const c = await fixture(),
      events = parseListing(c, esport),
      e = parseDetail(c, esport, ids[esport]);
    assert.equal(events.length, { cs2: 57, lol: 12, valorant: 11 }[esport]);
    assert.equal(new Set(events.map((e) => e.eventId)).size, events.length);
    assert.equal(e.provider, "blaze");
    assert.equal(
      e.markets.find((m) => m.category === "match_winner")?.rawMarketId,
      "186",
    );
    for (const map of [1, 2, 3]) {
      const m = e.markets.find(
        (m) => m.category === "map_winner" && m.map === map,
      );
      assert.ok(m);
      assert.equal(m.marketId, `330:mapnr=${map}`);
      assert.deepEqual(
        m.selections.map((s) => s.selectionId),
        ["4", "5"],
      );
      assert.ok(m.selections.every((s) => typeof s.odds === "number"));
    }
    assert.ok(
      events.some((e) => e.markets.some((m) => m.category === "unknown")),
    );
  });
test("Blaze observed CS2 UI odds match exact feed values", async () => {
  const e = parseDetail(await fixture(), "cs2", ids.cs2);
  assert.deepEqual(
    e.markets
      .filter((m) => ["match_winner", "map_winner"].includes(m.category))
      .map((m) => m.selections.map((s) => s.odds)),
    [
      [1.7, 2.08],
      [1.87, 1.87],
      [1.67, 2.12],
      [1.8, 1.94],
    ],
  );
});
test("Blaze rejects partial/mixed snapshots, conflicting IDs and malformed winner/map; accepts duplicate identical event", async () => {
  const c = await fixture();
  const bad = structuredClone(c);
  bad.data.shards.pop();
  assert.throws(() => parseListing(bad, "cs2"), /Incomplete/);
  const mixed = structuredClone(c);
  object(mixed.data.shards[0].data).epoch = 0;
  assert.throws(() => parseListing(mixed, "cs2"), /Invalid Blaze shard/);
  const entries = c.data.shards.map((s) => object(object(s.data).events));
  const original = entries.find((es) => ids.cs2 in es)![ids.cs2];
  entries.at(-1)![ids.cs2] = structuredClone(original);
  assert.equal(parseListing(c, "cs2").length, 57);
  object(entries.at(-1)![ids.cs2]).state = { status: 9 };
  assert.throws(() => parseListing(c, "cs2"), /Conflicting/);
});
test("Blaze preserves map 4/5 and raw invalid/blocked odds as null without inventing values", async () => {
  const c = await fixture(),
    entry = c.data.shards
      .map((s) => object(object(s.data).events))
      .find((es) => ids.cs2 in es)!;
  const markets = object(object(entry[ids.cs2]).markets),
    maps = object(markets["330"]);
  maps["mapnr=4"] = structuredClone(maps["mapnr=1"]);
  maps["mapnr=5"] = { "4": { k: "bad" }, "5": { k: "0.0", b: 1 } };
  let e = parseDetail(c, "cs2", ids.cs2),
    m = e.markets.find((m) => m.map === 5 && m.category === "map_winner")!;
  assert.ok(e.markets.some((m) => m.map === 4));
  assert.deepEqual(
    m.selections.map((s) => s.odds),
    [null, null],
  );
  assert.equal(m.selections[1].suspended, true);
  assert.equal(m.selections[0].raw.k, "bad");
  maps["mapnr=0"] = maps["mapnr=1"];
  assert.throws(() => parseListing(c, "cs2"), /Invalid map/);
});
test("Blaze works with generic matching: four providers, reversed names, ambiguous and single-provider events", async () => {
  const e = parseDetail(await fixture(), "cs2", ids.cs2);
  const peers = (["bet365", "betano", "superbet"] as const).map((provider) => ({
    ...structuredClone(e),
    provider,
    eventId: provider,
  }));
  const result = compareAllProviders([e, ...peers]);
  assert.equal(result.matched.length, 1);
  assert.equal(Object.keys(result.matched[0].providers).length, 4);
  assert.equal(compareAllProviders([e]).notApplicable.length, 1);
  assert.equal(
    compareAllProviders([
      e,
      ...peers,
      { ...structuredClone(e), eventId: "duplicate" },
    ]).matched.length,
    0,
  );
});
test("Blaze file store/journal restores state, appends odds changes and preserves state on invalid input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blaze-store-"));
  try {
    const store = new BlazeStore(dir, new MarketJournal(dir));
    await store.load();
    const c = await fixture();
    await store.ingest({ kind: "listing", esport: "cs2", capture: c });
    await store.ingest({
      kind: "detail",
      esport: "cs2",
      eventId: ids.cs2,
      capture: c,
    });
    const before = structuredClone(store.details.get(ids.cs2));
    const next = structuredClone(c);
    next.capturedAt = new Date(Date.parse(c.capturedAt) + 60000).toISOString();
    for (const s of next.data.shards) {
      const d = object(s.data);
      d.generated = Number(d.generated) + 60000;
      const e = object(d.events)[ids.cs2];
      if (e)
        object(object(object(object(e).markets)["186"])[""])["4"] = {
          k: "1.68",
        };
    }
    await store.ingest({
      kind: "detail",
      esport: "cs2",
      eventId: ids.cs2,
      capture: next,
    });
    assert.equal(before!.markets[0].selections[0].odds, 1.7);
    assert.equal(
      store.details.get(ids.cs2)!.markets[0].selections[0].odds,
      1.68,
    );
    const restored = new BlazeStore(dir, new MarketJournal(dir));
    await restored.load();
    assert.deepEqual(restored.details, store.details);
    const invalid = structuredClone(next);
    invalid.data.shards = [];
    await assert.rejects(() =>
      store.ingest({ kind: "listing", esport: "cs2", capture: invalid }),
    );
    assert.equal(store.listings.get("cs2")!.matches.length, 57);
    const journal = await readFile(
      join(dir, "market-snapshots.ndjson"),
      "utf8",
    );
    assert.match(journal, /OddsChanged/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { projectCapture } from "../parsers/capture-projection.js";
test("Blaze sport projection preserves normalized output and cannot be consumed as another sport", async () => {
  const c = await fixture();
  for (const esport of ["cs2", "lol", "valorant"] as const) {
    const p = projectCapture(c, esport);
    assert.deepEqual(parseListing(p, esport), parseListing(c, esport));
    assert.ok(JSON.stringify(p).length < JSON.stringify(c).length);
    assert.throws(
      () => parseListing(p, esport === "cs2" ? "lol" : "cs2"),
      /projection/,
    );
  }
});

import { marketChanges, snapshots } from "../../snapshots/market-journal.js";
test("Blaze suspension/reopening and removal preserve existing journal semantics", async () => {
  const c = await fixture(),
    before = parseDetail(c, "cs2", "2711247139689869329");
  const d = structuredClone(c);
  for (const s of d.data.shards) {
    const e = object(object(s.data).events)["2711247139689869329"];
    if (e) {
      const selections = object(object(object(object(e).markets)["186"])[""]);
      for (const v of Object.values(selections)) object(v).b = 1;
    }
  }
  const blocked = parseDetail(d, "cs2", before.eventId);
  assert.ok(
    marketChanges([before], [blocked], c.capturedAt, true).some(
      (c) => c.type === "MarketSuspended",
    ),
  );
  assert.ok(
    marketChanges([blocked], [before], c.capturedAt, true).some(
      (c) => c.type === "MarketReopened",
    ),
  );
  assert.ok(
    snapshots([blocked])
      .filter((s) => s.marketId === "186")
      .every((s) => s.suspended === true),
  );
  const changes = marketChanges([before], [], c.capturedAt, true);
  assert.ok(changes.some((c) => c.type === "EventRemoved"));
  assert.ok(!JSON.stringify(changes).includes("EventFinished"));
});
