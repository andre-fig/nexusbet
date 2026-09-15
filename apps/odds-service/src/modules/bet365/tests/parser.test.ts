import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseCapture,
  records,
  decimalOdds,
  londonTime,
} from "../parsers/list.parser.js";
import { changes, Store } from "../persistence/list.store.js";
import type { Capture, Esport } from "../types/model.js";
const fixture = async (s: Esport) =>
  JSON.parse(
    await readFile(new URL(`../fixtures/${s}.json`, import.meta.url), "utf8"),
  ) as Capture;
test("current CS2 feed retains an IB=2 event as suspended with its observed odds", async () => {
  const c = JSON.parse(
    await readFile(
      new URL("../fixtures/cs2-ib2-sanitized.json", import.meta.url),
      "utf8",
    ),
  ) as Capture;
  const parsed = parseCapture(c);
  assert.equal(parsed.matches.length, 48);
  const event = parsed.matches.find((match) => match.eventId === "201160585");
  assert.ok(event);
  assert.equal(event.status, "suspended");
  assert.equal(event.markets[0].selections.length, 2);
  assert.ok(
    event.markets[0].selections.every((selection) => selection.odds > 1),
  );
  assert.equal(parsed.provenance[event.eventId].inPlay, false);
  assert.equal(parsed.provenance[event.eventId].marketSuspended, true);
});
test("real responses: identify all 3 games, IDs, numeric odds and associations", async () => {
  for (const game of ["cs2", "lol", "valorant"] as const) {
    const c = await fixture(game),
      p = parseCapture(c);
    assert.ok(p.matches.length > 0);
    assert.ok(
      p.matches.every(
        (m) =>
          m.esport === game &&
          /^\d+$/.test(m.eventId) &&
          m.status === "scheduled",
      ),
    );
    for (const m of p.matches) {
      assert.equal(m.markets[0].selections.length, 2);
      assert.equal(m.markets[0].marketId, `${m.eventId}:1510001`);
      assert.deepEqual(
        m.markets[0].selections.map((s) => s.name),
        [m.teamA, m.teamB],
      );
      assert.ok(
        m.markets[0].selections.every(
          (s) =>
            Number.isFinite(s.odds) &&
            s.odds > 1 &&
            /^\d+$/.test(s.selectionId),
        ),
      );
    }
  }
});
test("visual comparison: three real matches across the three games", async () => {
  for (const [game, id, a, b, odds, starts] of [
    [
      "cs2",
      "201189423",
      "OLDBOYS PL",
      "LPH Gaming",
      [1.36, 3],
      "2026-09-14T17:30:00.000Z",
    ],
    [
      "lol",
      "200976787",
      "Estral Esports",
      "KaBuM! IDL",
      [1.1, 6.5],
      "2026-09-14T20:00:00.000Z",
    ],
    [
      "valorant",
      "200993812",
      "100 Thieves",
      "T1",
      [1.36, 3],
      "2026-09-24T09:00:00.000Z",
    ],
  ] as const) {
    const p = parseCapture(await fixture(game));
    const m = p.matches.find((m) => m.eventId === id)!;
    assert.equal(m.teamA, a);
    assert.equal(m.teamB, b);
    assert.deepEqual(
      m.markets[0].selections.map((s) => s.odds),
      odds,
    );
    assert.equal(m.startsAt, starts);
  }
});
test("column-wise PA data uses FI, not the preceding MA FI", async () => {
  const m = parseCapture(await fixture("valorant")).matches.find(
    (m) => m.eventId === "200993814",
  )!;
  assert.deepEqual(
    m.markets[0].selections.map((s) => s.name),
    ["Global Esports", "Team Vitality"],
  );
  assert.deepEqual(
    m.markets[0].selections.map((s) => s.odds),
    [2, 1.72],
  );
});
test("fractional conversion matches UI precision, not generic rounding", () => {
  assert.equal(decimalOdds("11/8"), 2.37);
  assert.equal(decimalOdds("8/15"), 1.53);
  assert.equal(decimalOdds("1/12"), 1.083);
  assert.equal(decimalOdds("1/1000"), 1.001);
  for (const bad of ["1/0", "NaN", "0/1", "-1/2", "2.3", "1/2junk"])
    assert.throws(() => decimalOdds(bad));
});
test("London clock supports winter; rejects invalid and ambiguous DST times", () => {
  assert.equal(londonTime("20260101120000"), "2026-01-01T12:00:00.000Z");
  for (const bad of ["20260231120000", "20261025013000", "20260329013000", "x"])
    assert.throws(() => londonTime(bad));
});
test("empty, partial, wrong scope and missing selections fail closed", async () => {
  const c = await fixture("lol");
  for (const body of [
    "",
    "U|PA;ID=1;OD=1/1;",
    c.body.replace("ID=151;", "ID=1;"),
    c.body.replace(/PA;ID=2103328710;[^|]+\|/, ""),
  ])
    assert.throws(() => parseCapture({ ...c, body }));
  assert.throws(() => parseCapture({ ...c, esport: "cs2" }));
  assert.equal(records("F|CL;ID=151;NA=a=b;")[0].fields.NA, "a=b");
});
test("synthetic status variants: suspension and live, no time-based finished inference", async () => {
  const c = await fixture("lol");
  const p = parseCapture({ ...c, body: c.body.replace("IB=0;", "IB=1;") });
  assert.equal(
    p.matches.find((m) => m.eventId === "200976787")!.status,
    "live",
  );
  const suspended = parseCapture({
    ...c,
    body: c.body.replace("OD=1/10;SU=0;", "OD=1/10;SU=1;"),
  });
  assert.equal(
    suspended.matches.find((m) => m.eventId === "200976787")!.status,
    "suspended",
  );
});
test("deduplicates exact selection records and rejects conflicting ones", async () => {
  const c = await fixture("lol");
  const record = "PA;ID=2103328704;FI=200976787;OD=1/10;SU=0;PZ=200976787;|";
  const d = parseCapture({
    ...c,
    body: c.body.replace(record, record + record),
  });
  assert.equal(
    d.matches.find((m) => m.eventId === "200976787")!.markets[0].selections
      .length,
    2,
  );
  assert.throws(() =>
    parseCapture({
      ...c,
      body: c.body.replace(record, record + record.replace("1/10", "1/5")),
    }),
  );
});
test("odds, status transitions and disappearance are distinct changes", async () => {
  const c = await fixture("lol"),
    prev = parseCapture(c).matches;
  const next = structuredClone(prev);
  next[0].markets[0].selections[0].odds = 1.2;
  next[0].status = "live";
  next.pop();
  const events = changes(prev, next, c.capturedAt, c.source);
  assert.ok(events.some((e) => e.type === "odds_changed"));
  assert.ok(events.some((e) => e.type === "entered_live"));
  assert.ok(events.some((e) => e.type === "disappeared"));
  assert.ok(!events.some((e) => e.type === "finished"));
  const fin = structuredClone(prev);
  fin[0].status = "finished";
  assert.ok(
    changes(prev, fin, c.capturedAt, c.source).some(
      (e) => e.type === "finished",
    ),
  );
  assert.equal(changes(prev, prev, c.capturedAt, c.source).length, 0);
});
test("snapshot deduplication, freshness updates, persistence and invalid feed preservation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bet365-test-"));
  try {
    const store = new Store(dir);
    await store.load();
    const c = await fixture("lol");
    const first = await store.ingest(c);
    assert.ok(first.matches > 0);
    assert.equal((await store.ingest(c)).ignored, true);
    const later = { ...c, capturedAt: "2026-09-14T16:00:00.000Z" };
    assert.equal((await store.ingest(later)).changes, 0);
    await assert.rejects(store.ingest({ ...later, body: "" }));
    const reloaded = new Store(dir);
    await reloaded.load();
    assert.deepEqual(reloaded.state, store.state);
    assert.equal((await reloaded.ingest(c)).ignored, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("real later captures: stable IDs, two changed LoL odds, new CS2 event", async () => {
  for (const game of ["cs2", "lol", "valorant"] as const) {
    const first = await fixture(game),
      later = JSON.parse(
        await readFile(
          new URL(`../fixtures/${game}-later.json`, import.meta.url),
          "utf8",
        ),
      ) as Capture;
    const a = parseCapture(first).matches,
      b = parseCapture(later).matches;
    for (const old of a) {
      const next = b.find((m) => m.eventId === old.eventId)!;
      assert.ok(next);
      assert.equal(next.markets[0].marketId, old.markets[0].marketId);
      assert.deepEqual(
        next.markets[0].selections.map((s) => s.selectionId),
        old.markets[0].selections.map((s) => s.selectionId),
      );
    }
    const d = changes(a, b, later.capturedAt, later.source);
    if (game === "lol") {
      assert.equal(d.filter((c) => c.type === "odds_changed").length, 2);
      const m = b.find((m) => m.eventId === "200980887")!;
      assert.deepEqual(
        m.markets[0].selections.map((s) => s.odds),
        [3.75, 1.25],
      );
    }
    if (game === "cs2") {
      assert.equal(d.length, 1);
      assert.equal(d[0].type, "appeared");
      assert.equal(d[0].eventId, "201263020");
    }
    if (game === "valorant") assert.equal(d.length, 0);
  }
});
