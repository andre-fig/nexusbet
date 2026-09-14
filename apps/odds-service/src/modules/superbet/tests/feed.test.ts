import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseListing, parseDetail } from "../parsers/feed.parser.js";
import { SuperbetStore } from "../persistence/superbet.store.js";
import { MarketJournal } from "../../snapshots/market-journal.js";
import type { SuperbetCapture, SuperbetRound } from "../types/feed.js";
// Mutable payloads below are explicit fault simulations derived from untouched real fixtures.
export const fixture = async (name: string) =>
  JSON.parse(
    await readFile(
      new URL("../fixtures/" + name + ".json", import.meta.url),
      "utf8",
    ),
  );
for (const [game, count, maps, total] of [
  ["cs2", 62, 3, 61],
  ["lol", 10, 5, 92],
  ["valorant", 9, 3, 101],
] as const) {
  test(`${game}: real list/detail, numeric prices, stable UUIDs, all maps and unknown markets`, async () => {
    const structure = await fixture("structure"),
      c = await fixture(game + "-detail");
    const events = parseListing(await fixture(game + "-list"), game, structure),
      e = parseDetail(c, game, String(c.data.data[0].eventId), structure);
    assert.equal(events.length, count);
    assert.equal(e.markets.length, total);
    assert.equal(e.provider, "superbet");
    assert.equal(e.status, "scheduled");
    assert.equal(e.inPlay, false);
    const winner = e.markets.find((m) => m.category === "match_winner")!;
    assert.deepEqual(
      winner.selections.map((s) => s.name),
      [e.teamA, e.teamB],
    );
    assert.deepEqual(
      winner.selections.map((s) => s.odds),
      c.data.data[0].odds.slice(0, 2).map((o: { price: number }) => o.price),
    );
    assert.deepEqual(
      e.markets.filter((m) => m.category === "map_winner").map((m) => m.map),
      Array.from({ length: maps }, (_, i) => i + 1),
    );
    assert.equal(new Set(e.markets.map((m) => m.marketId)).size, total);
    const listed = events.find((x) => x.eventId === e.eventId)!;
    assert.equal(listed.markets[0].marketId, winner.marketId);
    assert.ok(
      e.markets.some((m) => m.category === "unknown" && m.raw.specifiers),
    );
    for (const m of e.markets)
      for (const s of m.selections) {
        assert.ok(s.selectionId);
        assert.equal(typeof s.odds, "number");
        assert.equal(s.suspended, false);
        assert.ok(s.raw.outcomeId);
      }
  });
}
test("capture scope, malformed odds, duplicate conflicts and missing map are rejected", async () => {
  const structure = await fixture("structure"),
    original = await fixture("lol-detail");
  const parse = (c: SuperbetCapture) =>
    parseDetail(c, "lol", "14986522", structure);
  const duplicate = structuredClone(original);
  duplicate.data.data[0].odds.push(duplicate.data.data[0].odds[0]);
  assert.deepEqual(parse(duplicate).markets, parse(original).markets);
  duplicate.data.data[0].odds[duplicate.data.data[0].odds.length - 1] = {
    ...duplicate.data.data[0].odds[0],
    price: 9,
  };
  assert.throws(() => parse(duplicate), /Conflicting/);
  for (const mutate of [
    (c: typeof original) => (c.data.data[0].odds[0].price = "NaN"),
    (c: typeof original) => delete c.data.data[0].odds[2].specifiers,
    (c: typeof original) =>
      (c.source.url = "https://example.org/v2/pt-BR/events/14986522"),
    (c: typeof original) => (c.data.data = []),
  ]) {
    const c = structuredClone(original);
    mutate(c);
    assert.throws(() => parse(c));
  }
  const listing = await fixture("lol-list");
  listing.data.events.push(structuredClone(listing.data.events[0]));
  assert.equal(parseListing(listing, "lol", structure).length, 10);
  listing.data.events[0].is_full_market_update = false;
  assert.throws(() => parseListing(listing, "lol", structure), /Partial/);
  const live = structuredClone(original);
  live.data.data[0].metadata.status = "LIVE";
  assert.throws(() => parse(live), /Pre-game window ended/);
});
test("append-only snapshots, odds changes, suspension/reopening, removals and restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "superbet-store-"));
  try {
    const store = new SuperbetStore(dir, new MarketJournal(dir));
    await store.load();
    const structure = await fixture("structure"),
      capture = await fixture("lol-detail");
    const round: SuperbetRound = {
      kind: "detail",
      esport: "lol",
      eventId: "14986522",
      capture,
      structure,
    };
    await store.ingest(round);
    await store.ingest(round);
    const update = structuredClone(round);
    update.capture.capturedAt = new Date(
      Date.parse(capture.capturedAt) + 1000,
    ).toISOString();
    const data = update.capture.data as typeof capture.data;
    data.data[0].odds[0].price = 1.4;
    data.data[0].odds[0].status = "suspended";
    data.data[0].odds[1].status = "suspended";
    await store.ingest(update);
    const reopen = structuredClone(round);
    reopen.capture.capturedAt = new Date(
      Date.parse(capture.capturedAt) + 2000,
    ).toISOString();
    await store.ingest(reopen);
    const missingMarket = structuredClone(reopen);
    missingMarket.capture.capturedAt = new Date(
      Date.parse(capture.capturedAt) + 3000,
    ).toISOString();
    const payload = missingMarket.capture.data as typeof capture.data;
    const lastUuid = payload.data[0].odds.at(-1).marketUuid;
    payload.data[0].odds = payload.data[0].odds.filter(
      (o: { marketUuid: string }) => o.marketUuid !== lastUuid,
    );
    payload.data[0].counts.odds["1"] = payload.data[0].odds.length;
    await store.ingest(missingMarket);
    const before = JSON.stringify([...store.details]);
    const invalid = structuredClone(round);
    (invalid.capture.data as typeof capture.data).data = [];
    await assert.rejects(store.ingest(invalid));
    assert.equal(JSON.stringify([...store.details]), before);
    const list: SuperbetRound = {
      kind: "listing",
      esport: "lol",
      capture: await fixture("lol-list"),
      structure,
    };
    await store.ingest(list);
    const removed = structuredClone(list);
    removed.capture.capturedAt = new Date(
      Date.parse(list.capture.capturedAt) + 1000,
    ).toISOString();
    (removed.capture.data as { events: unknown[] }).events.pop();
    await store.ingest(removed);
    const entries = (
      await readFile(join(dir, "market-snapshots.ndjson"), "utf8")
    )
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    assert.equal(entries.length, 6);
    const changes = entries.flatMap((e) => e.changes);
    for (const type of [
      "EventAdded",
      "EventRemoved",
      "MarketAdded",
      "MarketRemoved",
      "MarketSuspended",
      "MarketReopened",
      "OddsChanged",
    ])
      assert.ok(
        changes.some((c) => c.type === type),
        type,
      );
    assert.ok(!changes.some((c) => c.type === "EventFinished"));
    assert.equal(entries[0].snapshots[0].odds, 1.35);
    assert.equal(entries[1].snapshots[0].odds, 1.4);
    assert.equal(entries[0].snapshots[0].provider, "superbet");
    const restored = new SuperbetStore(dir, new MarketJournal(dir));
    await restored.load();
    assert.deepEqual([...restored.details], [...store.details]);
    assert.deepEqual([...restored.listings], [...store.listings]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unrelated untranslated directory entries are tolerated; missing referenced tournaments and partial detail are rejected", async () => {
  const structure = await fixture("structure"),
    extra = await fixture("untranslated-structure");
  structure.data.data.tournaments.push(...extra.data.data.tournaments);
  const c = await fixture("lol-detail");
  assert.equal(
    parseDetail(c, "lol", "14986522", structure).tournament,
    "LCK Challengers",
  );
  const partial = structuredClone(c);
  partial.data.data[0].odds.pop();
  assert.throws(
    () => parseDetail(partial, "lol", "14986522", structure),
    /Incomplete prematch/,
  );
  structure.data.data.tournaments = [];
  assert.throws(
    () => parseDetail(c, "lol", "14986522", structure),
    /Missing tournament/,
  );
});

test("real alternative feed uses explicit PREMATCH stream when metadata is absent", async () => {
  const c = await fixture("lol-lec-detail"),
    structure = await fixture("structure");
  assert.equal(c.data.data[0].metadata, undefined);
  const e = parseDetail(c, "lol", "14961853", structure);
  assert.equal(e.status, "scheduled");
  assert.equal(e.inPlay, false);
  assert.equal(e.markets.filter((m) => m.category === "map_winner").length, 3);
  c.data.data[0].streams = ["PREMATCH", "LIVE"];
  assert.throws(
    () => parseDetail(c, "lol", "14961853", structure),
    /Unknown event status/,
  );
});
