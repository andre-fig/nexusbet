import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseListing, parseDetail } from "../parsers/feed.parser.js";
import { object, rows } from "../types/feed.js";
import { fixture, eventIds } from "./fixtures.js";
import { EstrelaBetStore } from "../persistence/estrelabet.store.js";
import {
  MarketJournal,
  marketChanges,
  snapshots,
} from "../../snapshots/market-journal.js";
import { compareAllProviders } from "../../matching/matching.js";
for (const esport of ["cs2", "lol", "valorant"] as const)
  test(`EstrelaBet real ${esport}: list/detail, IDs, numeric winners, maps and unknown markets`, async () => {
    const list = parseListing(await fixture(), esport);
    assert.equal(list.length, { cs2: 36, lol: 3, valorant: 2 }[esport]);
    assert.equal(new Set(list.map((e) => e.eventId)).size, list.length);
    const e = parseDetail(await fixture(esport), esport, eventIds[esport]);
    assert.equal(e.provider, "estrelabet");
    assert.ok(e.markets.some((m) => m.category === "unknown"));
    const winners = e.markets.filter(
      (m) => m.category === "match_winner" || m.category === "map_winner",
    );
    assert.equal(winners[0].category, "match_winner");
    assert.deepEqual(
      winners.slice(1).map((m) => m.map),
      esport === "lol" ? [1, 2, 3] : [1, 2],
    );
    for (const m of winners) {
      assert.equal(m.marketId, m.rawMarketId);
      assert.equal(m.selections.length, 2);
      assert.ok(
        m.selections.every(
          (s) =>
            /^\d+$/.test(s.selectionId) &&
            typeof s.odds === "number" &&
            s.odds > 1,
        ),
      );
    }
  });
test("EstrelaBet preserves feed precision; UI displays truncated two-decimal prices", async () => {
  const e = parseDetail(await fixture("cs2"), "cs2", eventIds.cs2);
  const m = e.markets.find((m) => m.category === "match_winner")!;
  assert.deepEqual(
    m.selections.map((s) => s.odds),
    [1.5264, 2.3],
  );
  assert.deepEqual(
    m.selections.map((s) => s.odds!.toFixed(4).slice(0, -2)),
    ["1.52", "2.30"],
  );
});
test("EstrelaBet rejects partial pages, broken references and conflicting IDs; deduplicates identical entries", async () => {
  let c = await fixture();
  c.data.pages!.pop();
  assert.throws(() => parseListing(c, "cs2"), /Incomplete/);
  c = await fixture();
  const p = object(c.data.pages![0]),
    events = rows(p.events);
  p.events = [...events, events.find((e) => e.id === Number(eventIds.cs2))];
  assert.equal(parseListing(c, "cs2").length, 36);
  p.events = [
    ...rows(p.events),
    {
      ...events.find((e) => e.id === Number(eventIds.cs2)),
      startDate: "2026-09-15T11:00:00Z",
    },
  ];
  assert.throws(() => parseListing(c, "cs2"), /Conflicting/);
  c = await fixture("cs2");
  object(c.data.detail).odds = [];
  assert.throws(() => parseDetail(c, "cs2", eventIds.cs2), /Missing/);
});
test("EstrelaBet map 4/5, unknown types, invalid odds and raw secret exclusion", async () => {
  const c = await fixture("lol"),
    d = object(c.data.detail),
    ms = rows(d.markets),
    map = ms.find((m) => m.typeId === 395)!;
  ms.push(
    { ...map, id: "map-four", sv: "4" },
    { ...map, id: "map-five", sv: "5" },
    {
      ...map,
      id: "unknown",
      typeId: 999999,
      sv: "7",
      name: "Unknown future market",
    },
  );
  d.markets = ms;
  const odds = rows(d.odds);
  odds.find((o) => o.id === 4489473478)!.price = 0;
  odds.find((o) => o.id === 4489473479)!.oddStatus = 1;
  d.odds = odds;
  d.cookies = "secret";
  ms[1].authorization = "secret";
  odds[0].token = "secret";
  const e = parseDetail(c, "lol", eventIds.lol);
  assert.ok(e.markets.some((m) => m.map === 4));
  const five = e.markets.find((m) => m.map === 5)!;
  assert.equal(five.selections[0].odds, null);
  assert.equal(five.selections[1].suspended, true);
  assert.equal(
    e.markets.find((m) => m.marketId === "unknown")!.category,
    "unknown",
  );
  assert.ok(!JSON.stringify(e).includes("secret"));
  map.sv = "0";
  assert.throws(() => parseDetail(c, "lol", eventIds.lol), /specifier/);
});
test("EstrelaBet skips live and stops started details without declaring finished", async () => {
  const c = await fixture();
  for (const p of c.data.pages!)
    for (const e of rows(object(p).events)) if (e.catId === 1534) e.status = 1;
  assert.equal(parseListing(c, "cs2").length, 0);
  const d = await fixture("cs2");
  object(d.data.detail).startDate = d.capturedAt;
  assert.throws(() => parseDetail(d, "cs2", eventIds.cs2), /Pre-game/);
});
test("EstrelaBet generic matching supports five providers, reversed names, different tournaments and ambiguity", async () => {
  const e = parseDetail(await fixture("cs2"), "cs2", eventIds.cs2),
    peers = (["bet365", "betano", "superbet", "blaze"] as const).map(
      (provider) => ({ ...structuredClone(e), provider, eventId: provider }),
    );
  peers[0] = { ...peers[0], teamA: e.teamB, teamB: e.teamA };
  const r = compareAllProviders([e, ...peers]);
  assert.equal(r.matched.length, 1);
  assert.equal(Object.keys(r.matched[0].providers).length, 5);
  assert.equal(compareAllProviders([e]).unmatched.length, 1);
  assert.equal(
    compareAllProviders([e, { ...peers[0], tournament: "Other League" }])
      .matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([e, ...peers, { ...e, eventId: "ambiguous" }]).matched
      .length,
    0,
  );
});
test("EstrelaBet store and journal append odds, preserve snapshots on failure, restore after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "estrela-store-"));
  try {
    const store = new EstrelaBetStore(dir, new MarketJournal(dir));
    await store.load();
    await store.ingest({
      kind: "listing",
      esport: "cs2",
      capture: await fixture(),
    });
    let c = await fixture("cs2");
    await store.ingest({
      kind: "detail",
      esport: "cs2",
      eventId: eventIds.cs2,
      capture: c,
    });
    const before = structuredClone(store.details.get(eventIds.cs2));
    c = structuredClone(c);
    c.capturedAt = new Date(Date.parse(c.capturedAt) + 60000).toISOString();
    rows(object(c.data.detail).odds).find((o) => o.id === 4499161413)!.price =
      1.68;
    await store.ingest({
      kind: "detail",
      esport: "cs2",
      eventId: eventIds.cs2,
      capture: c,
    });
    assert.equal(
      before!.markets.find((m) => m.category === "match_winner")!.selections[0]
        .odds,
      1.5264,
    );
    const restored = new EstrelaBetStore(dir, new MarketJournal(dir));
    await restored.load();
    assert.deepEqual(restored.details, store.details);
    object(c.data.detail).markets = [];
    await assert.rejects(() =>
      store.ingest({
        kind: "detail",
        esport: "cs2",
        eventId: eventIds.cs2,
        capture: c,
      }),
    );
    assert.deepEqual(store.details, restored.details);
    assert.match(
      await readFile(join(dir, "market-snapshots.ndjson"), "utf8"),
      /OddsChanged/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("EstrelaBet suspension, reopening, market and event removal keep common journal semantics", async () => {
  const c = await fixture("cs2"),
    before = parseDetail(c, "cs2", eventIds.cs2);
  for (const o of rows(object(c.data.detail).odds)) o.oddStatus = 1;
  const blocked = parseDetail(c, "cs2", eventIds.cs2);
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
  assert.ok(snapshots([blocked]).every((s) => s.suspended === true));
  assert.ok(
    marketChanges(
      [before],
      [{ ...before, markets: [] }],
      c.capturedAt,
      true,
    ).some((c) => c.type === "MarketRemoved"),
  );
  const removed = marketChanges([before], [], c.capturedAt, true);
  assert.ok(removed.some((c) => c.type === "EventRemoved"));
  assert.ok(!JSON.stringify(removed).includes("EventFinished"));
});
test("EstrelaBet rejects unknown status, empty market coverage and empty inbox rounds without deleting catalogue", async () => {
  const c = await fixture(),
    p = object(c.data.pages![0]);
  const e = rows(p.events).find((e) => e.id === Number(eventIds.cs2))!;
  e.status = 99;
  assert.throws(() => parseListing(c, "cs2"), /Unknown/);
  e.status = 0;
  e.marketIds = [];
  assert.throws(() => parseListing(c, "cs2"), /Empty/);
  const dir = await mkdtemp(join(tmpdir(), "estrela-empty-"));
  try {
    const store = new EstrelaBetStore(dir, new MarketJournal(dir));
    const valid = await fixture();
    await store.ingest({ kind: "listing", esport: "cs2", capture: valid });
    const previous = structuredClone(store.listings);
    const empty = structuredClone(valid);
    for (const p of empty.data.pages!) object(p).events = [];
    await assert.rejects(
      () => store.ingest({ kind: "listing", esport: "cs2", capture: empty }),
      /Empty/,
    );
    assert.deepEqual(store.listings, previous);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
