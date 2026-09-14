import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCapture, records } from "../parsers/list.parser.js";
import { parseDetail } from "../parsers/coupon.parser.js";
import {
  normalizeRound,
  DetailStore,
  type DetailRound,
} from "../persistence/detail.store.js";
import type { Capture, Esport } from "../types/model.js";
const specs = {
  lol: {
    eventId: "200976787",
    tabs: ["main", "match", "map1", "map2", "map3"],
    markets: 24,
    selections: 64,
  },
  cs2: {
    eventId: "201241261",
    tabs: ["main", "map1", "map2"],
    markets: 30,
    selections: 62,
  },
  valorant: {
    eventId: "200993812",
    tabs: ["main", "match", "map1", "map2"],
    markets: 83,
    selections: 366,
  },
};
const fixture = async (game: Esport, tab: string) =>
  JSON.parse(
    await readFile(
      new URL(`../fixtures/details/${game}-${tab}.json`, import.meta.url),
      "utf8",
    ),
  ) as Capture;
async function round(game: Esport): Promise<DetailRound> {
  return {
    eventId: specs[game].eventId,
    listing: await fixture(game, "list"),
    captures: await Promise.all(
      specs[game].tabs.map((tab) => fixture(game, tab)),
    ),
    coverage: "all_tabs",
  };
}
test("real detail feeds: all selections retained across all advertised tabs of three sports", async () => {
  for (const game of Object.keys(specs) as Esport[]) {
    const r = await round(game),
      p = normalizeRound(r);
    assert.equal(p.match.markets.length, specs[game].markets);
    assert.equal(
      p.match.markets.reduce((n, m) => n + m.selections.length, 0),
      specs[game].selections,
    );
    for (const [i, part] of p.parts.entries()) {
      const ids = records(r.captures[i].body)
        .filter((r) => r.type === "PA" && /^\d+$/.test(r.fields.ID || ""))
        .map((r) => r.fields.ID);
      assert.deepEqual(
        new Set(
          part.match.markets.flatMap((m) =>
            m.selections.map((s) => s.selectionId),
          ),
        ),
        new Set(ids),
      );
      assert.equal(part.match.inPlay, false);
      assert.ok(
        part.match.markets.every(
          (m) => m.map === null || (m.map >= 1 && m.map <= 3),
        ),
      );
    }
  }
});
test("real Estral detail matches all seven primary markets and UI prices", async () => {
  const r = await round("lol"),
    m = normalizeRound(r).parts[0].match;
  assert.deepEqual(
    m.markets.map((m) => m.category),
    [
      "match_winner",
      "match_handicap",
      "map_winner",
      "kill_handicap",
      "total_kills",
      "map_winner",
      "map_winner",
    ],
  );
  assert.deepEqual(
    m.markets.map((m) => m.selections.map((s) => s.odds)),
    [
      [1.071, 7.5],
      [2, 1.72],
      [1.25, 3.75],
      [1.83, 1.83],
      [1.83, 1.83],
      [1.25, 3.75],
      [1.25, 3.75],
    ],
  );
  assert.deepEqual(
    m.markets[1].selections.map((s) => s.line),
    [-2.5, 2.5],
  );
  assert.deepEqual(
    m.markets[3].selections.map((s) => s.line),
    [-10.5, 10.5],
  );
  assert.equal(m.markets[4].line, 28.5);
  assert.deepEqual(
    m.markets[4].selections.map((s) => s.side),
    ["over", "under"],
  );
});
test("real CS2 and Valorant: O/U is a selection side, half/round winners are not map winners", async () => {
  const cs = normalizeRound(await round("cs2")).parts[0].match;
  assert.deepEqual(
    cs.markets[0].selections.map((s) => s.odds),
    [2, 1.72],
  );
  const total = cs.markets.find((m) => m.rawMarketId === "1512843")!;
  assert.deepEqual(
    total.selections.map((s) => [s.name, s.side, s.line, s.odds]),
    [
      ["Mais de", "over", 21.5, 2],
      ["Menos de", "under", 21.5, 1.72],
    ],
  );
  assert.equal(
    cs.markets.find((m) => m.rawMarketId === "1511933")!.category,
    "first_half_winner",
  );
  assert.equal(
    cs.markets.find((m) => m.rawMarketId === "1514376")!.selections.length,
    3,
  );
  const va = normalizeRound(await round("valorant")).parts[0].match;
  assert.deepEqual(
    va.markets[0].selections.map((s) => s.odds),
    [1.36, 3],
  );
  assert.equal(va.markets.find((m) => m.rawMarketId === "1514263")!.round, 13);
  assert.equal(
    va.markets.find((m) => m.rawMarketId === "1514263")!.category,
    "round_winner",
  );
  assert.equal(
    va.markets.find((m) => m.rawMarketId === "1514210")!.line,
    147.5,
  );
});
test("unknown markets, grid score labels and multiple alternative lines retain their meaning", async () => {
  const lol = normalizeRound(await round("lol")).match;
  const dragon = lol.markets.find((m) => m.rawMarketId === "1511004")!;
  assert.equal(dragon.category, "unknown");
  assert.deepEqual(
    dragon.selections.map((s) => s.name),
    [
      "Das Nuvens",
      "Infernal",
      "Da Montanha",
      "Do Oceano",
      "Chemtech",
      "Hextech",
    ],
  );
  const score = lol.markets.find((m) => m.category === "correct_score")!;
  assert.deepEqual(
    score.selections.map((s) => s.name),
    [
      "Estral Esports 3-0",
      "Estral Esports 3-1",
      "Estral Esports 3-2",
      "KaBuM! IDL 3-0",
      "KaBuM! IDL 3-1",
      "KaBuM! IDL 3-2",
    ],
  );
  const va = normalizeRound(await round("valorant")).match;
  assert.equal(va.markets.find((m) => m.rawMarketId === "1514160")!.map, null);
  const alternatives = va.markets.find((m) => m.rawMarketId === "1514245")!;
  assert.equal(alternatives.selections.length, 16);
  assert.ok(new Set(alternatives.selections.map((s) => s.line)).size > 2);
  assert.equal(alternatives.line, null);
});
test("synthetic missing odds, inherited suspension and wrong FI/route fail safely", async () => {
  const r = await round("lol"),
    listing = parseCapture(r.listing),
    ctx = {
      match: listing.matches.find((m) => m.eventId === r.eventId)!,
      inPlay: false,
    };
  const c = r.captures[0];
  assert.throws(() =>
    parseDetail({ ...c, body: c.body.replace("FI=200976787", "FI=999") }, ctx),
  );
  assert.throws(() =>
    parseDetail({ ...c, body: c.body.replace("OD=1/14;", "") }, ctx),
  );
  const suspended = parseDetail(
    { ...c, body: c.body.replace("OD=1/14;SU=0;", "SU=1;") },
    ctx,
  );
  assert.equal(suspended.match.markets[0].selections[0].odds, null);
  assert.equal(suspended.match.markets[0].selections[0].suspended, true);
  assert.throws(() =>
    parseDetail(
      { ...c, body: c.body.replace(/PA;ID=2103558657;[^|]+\|/, "") },
      ctx,
    ),
  );
  assert.throws(() =>
    normalizeRound({ ...r, captures: r.captures.slice(0, 1) }),
  );
});
test("detail publication preserves all-tab coverage, exact market timestamps and immutable history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bet365-details-"));
  try {
    const store = new DetailStore(dir);
    await store.load();
    const r = await round("lol");
    assert.equal(await store.ingest(r), true);
    assert.equal(await store.ingest(r), false);
    const before = store.latest.get(r.eventId);
    await assert.rejects(
      store.ingest({ ...r, captures: r.captures.slice(0, 1) }),
    );
    assert.equal(store.latest.get(r.eventId), before);
    const recovered = new DetailStore(dir);
    await recovered.load();
    assert.deepEqual(recovered.latest.get(r.eventId), before);
    const journal = (
      await readFile(join(dir, "market-snapshots.ndjson"), "utf8")
    )
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.equal(journal.length, 5);
    assert.ok(
      journal.every((e) =>
        e.snapshots.every((s: any) => s.fetchedAt === e.batch.fetchedAt),
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
