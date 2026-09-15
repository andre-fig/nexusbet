import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarketJournal, marketChanges, snapshots } from "../market-journal.js";
import type {
  DetailedMatch,
  MarketBatch,
} from "../../../shared/domain/market-model.js";
import type { PersistencePort } from "../../../shared/interfaces/persistence-port.interface.js";
// All scenarios in this file are synthetic; real protocol validation lives in fixture tests.
function match(): DetailedMatch {
  return {
    provider: "bet365",
    esport: "lol",
    eventId: "1",
    teamA: "A",
    teamB: "B",
    inPlay: false,
    suspended: false,
    fetchedAt: "2026-09-14T19:00:00.000Z",
    markets: [
      {
        marketId: "1:10",
        rawMarketId: "10",
        category: "unknown",
        name: "Example",
        groupId: null,
        groupName: null,
        map: null,
        line: null,
        suspended: false,
        inPlay: false,
        raw: {},
        selections: [
          {
            selectionId: "100",
            name: "A",
            odds: 1.1,
            line: null,
            side: null,
            suspended: false,
            inPlay: false,
            raw: {},
          },
          {
            selectionId: "101",
            name: "B",
            odds: 6.5,
            line: null,
            side: null,
            suspended: false,
            inPlay: false,
            raw: {},
          },
        ],
      },
    ],
  };
}
function batch(e = match()): MarketBatch {
  return {
    scope: "detail:lol:1:default",
    complete: true,
    matches: [e],
    fetchedAt: e.fetchedAt,
    source: {
      transport: "xhr",
      method: "GET",
      capture: "playwright-response",
      authenticated: false,
      url: "https://www.bet365.bet.br/contentdata/othersportsmatchbettingcontentapi/coupon",
    },
  };
}
test("SQL journals request only their provider baseline; unscoped SQL restore fails", async () => {
  const requested: string[] = [];
  const port = {
    enabled: true,
    baselines: async (provider) => {
      requested.push(provider);
      return provider === "bet365" ? [batch()] : [];
    },
  } as PersistencePort;
  const own = new MarketJournal("unused", port, "bet365");
  const other = new MarketJournal("unused", port, "superbet");
  await own.load();
  await other.load();
  assert.deepEqual(requested, ["bet365", "superbet"]);
  assert.equal(own.memoryDiagnostics().scopes, 1);
  assert.equal(other.memoryDiagnostics().scopes, 0);
  await assert.rejects(
    new MarketJournal("unused", port).load(),
    /Journal provider required/,
  );
});
test("selection snapshots retain two observed prices as separate records and survive restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexusbet-journal-"));
  try {
    const j = new MarketJournal(dir);
    await j.load();
    const a = batch();
    await j.ingest(a);
    assert.equal(await j.ingest(a), null);
    const b = structuredClone(a);
    b.fetchedAt = b.matches[0].fetchedAt = "2026-09-14T19:01:00.000Z";
    b.matches[0].markets[0].selections[0].odds = 1.071;
    b.matches[0].markets[0].selections[1].odds = 7.5;
    const result = await j.ingest(b);
    assert.deepEqual(
      result?.changes.map((c) => c.type),
      ["OddsChanged", "OddsChanged"],
    );
    const lines = (await readFile(join(dir, "market-snapshots.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.deepEqual(
      lines.map((l) => l.snapshots.map((s: any) => s.odds)),
      [
        [1.1, 6.5],
        [1.071, 7.5],
      ],
    );
    const reload = new MarketJournal(dir);
    await reload.load();
    assert.equal(await reload.ingest(b), null);
    assert.equal(await reload.ingest(a), null);
    await assert.rejects(reload.ingest({ ...b, matches: [] }));
    const conflict = structuredClone(b);
    conflict.matches[0].markets[0].selections[0].odds = 1.2;
    await assert.rejects(reload.ingest(conflict));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("all seven changes, market identity, and no inferred EventFinished", () => {
  const a = match(),
    b = structuredClone(a);
  b.markets[0].suspended = true;
  assert.equal(
    marketChanges([a], [b], a.fetchedAt, true)[0].type,
    "MarketSuspended",
  );
  assert.equal(
    marketChanges([b], [a], a.fetchedAt, true)[0].type,
    "MarketReopened",
  );
  const unknown = structuredClone(a);
  unknown.markets[0].suspended = null;
  assert.equal(marketChanges([b], [unknown], a.fetchedAt, true).length, 0);
  const add = structuredClone(a);
  add.markets.push({ ...structuredClone(a.markets[0]), marketId: "1:11" });
  assert.equal(
    marketChanges([a], [add], a.fetchedAt, true)[0].type,
    "MarketAdded",
  );
  assert.equal(
    marketChanges([add], [a], a.fetchedAt, true)[0].type,
    "MarketRemoved",
  );
  assert.equal(marketChanges([], [a], a.fetchedAt, true)[0].type, "EventAdded");
  assert.deepEqual(
    marketChanges([a], [], a.fetchedAt, true).map((c) => c.type),
    ["EventRemoved"],
  );
  assert.equal(marketChanges([a], [], a.fetchedAt, false).length, 0);
  assert.equal(marketChanges([add], [a], a.fetchedAt, false).length, 0);
});
test("market suspension overrides selection availability; missing odds stay null; handicap sign preserved", () => {
  const e = match();
  e.markets[0].suspended = true;
  e.markets[0].selections[0].odds = null;
  e.markets[0].selections[0].line = -2.5;
  e.markets[0].selections[1].line = 2.5;
  const ss = snapshots([e]);
  assert.equal(ss[0].suspended, true);
  assert.equal(ss[0].odds, null);
  assert.deepEqual(
    ss.map((s) => s.line),
    [-2.5, 2.5],
  );
});
test("same odds with a changed line is recorded; unchanged observations still snapshot", async () => {
  const a = match(),
    b = structuredClone(a);
  b.markets[0].line = 28.5;
  assert.equal(marketChanges([a], [b], a.fetchedAt, true).length, 2);
  const dir = await mkdtemp(join(tmpdir(), "nexusbet-journal-"));
  try {
    const j = new MarketJournal(dir);
    await j.load();
    const first = batch();
    const second = structuredClone(first);
    second.fetchedAt = second.matches[0].fetchedAt = "2026-09-14T19:02:00.000Z";
    const result = await Promise.all([j.ingest(first), j.ingest(second)]);
    assert.equal(result[1]?.changes.length, 0);
    assert.equal(result[1]?.snapshots.length, 2);
    await assert.rejects(
      j.ingest({
        ...second,
        complete: false,
        fetchedAt: "2026-09-14T19:03:00.000Z",
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
