import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import {
  parseListing,
  parseDetail,
  safeUrl,
  type BetanoCapture,
} from "../parsers/feed.parser.js";
import { BetanoBrowser } from "../transport/betano-browser.js";
import { BetanoStore } from "../persistence/betano.store.js";
import {
  MarketJournal,
  marketChanges,
  snapshots,
} from "../../snapshots/market-journal.js";
async function fixture(name: string): Promise<BetanoCapture> {
  return JSON.parse(
    await readFile(
      new URL("../fixtures/" + name + ".json", import.meta.url),
      "utf8",
    ),
  );
}
test("Betano real listings: all three regions, decimal prices, IDs, teams, UTC times; live excluded", async () => {
  for (const [sport, count] of [
    ["cs2", 4],
    ["lol", 1],
    ["valorant", 8],
  ] as const) {
    const c = await fixture(sport + "-list"),
      events = parseListing(c, sport);
    assert.equal(events.length, count);
    for (const e of events) {
      assert.equal(e.provider, "betano");
      assert.equal(e.status, "scheduled");
      assert.equal(e.rawTeamA, e.teamA);
      assert.match(e.startsAt, /Z$/);
      assert.equal(e.markets[0].category, "match_winner");
      assert.ok(
        e.markets[0].selections.every(
          (s) => typeof s.odds === "number" && /^\d+$/.test(s.selectionId),
        ),
      );
    }
  }
  const c = await fixture("cs2-list");
  const e = c.data.blocks[0].events[0];
  e.liveNow = true;
  e.url = e.url.replace("/odds/", "/live/");
  assert.equal(parseListing(c, "cs2").length, 3);
  assert.throws(() => parseListing({ ...c, provider: "bet365" } as any, "cs2"));
});
test("Betano real details match visual prices; structured map numbers include BO5 and unknowns", async () => {
  for (const [sport, count, prices] of [
    ["cs2", 3, [1.13, 5.3, 1.31, 3.3]],
    ["lol", 5, [2.75, 1.42, 2.32, 1.57]],
    ["valorant", 3, [1.4, 2.82, 1.5, 2.47]],
  ] as const) {
    const c = await fixture(sport + "-detail"),
      e = parseDetail(c, sport, c.data.event.id);
    const winner = e.markets.find((m) => m.category === "match_winner")!,
      maps = e.markets.filter((m) => m.category === "map_winner");
    assert.equal(maps.length, count);
    assert.deepEqual(
      maps.map((m) => m.map),
      Array.from({ length: count }, (_, i) => i + 1),
    );
    assert.deepEqual(
      [...winner.selections, ...maps[0].selections].map((s) => s.odds),
      prices,
    );
    assert.ok(e.markets.some((m) => m.category === "unknown"));
    assert.equal(e.markets.length, c.data.event.markets.length);
    assert.ok(
      e.markets.every((m) => m.marketId === e.eventId + ":" + m.rawMarketId),
    );
    assert.equal(maps[0].line, null);
    assert.ok(maps.every((m) => m.map !== 100));
  }
});
test("Betano duplicates, malformed odds and truncated winner markets fail safely", async () => {
  const c = await fixture("cs2-list");
  c.data.blocks[0].events.push(structuredClone(c.data.blocks[0].events[0]));
  assert.equal(parseListing(c, "cs2").length, 4);
  c.data.blocks[0].events.at(-1).markets[0].selections[0].price = 1.2;
  assert.throws(() => parseListing(c, "cs2"), /duplicate/);
  const d = await fixture("lol-detail");
  const e = d.data.event;
  e.markets[0].selections.push(structuredClone(e.markets[0].selections[0]));
  assert.equal(parseDetail(d, "lol", e.id).markets[0].selections.length, 2);
  e.markets[0].selections[0].price = "2.75";
  assert.throws(() => parseDetail(d, "lol", e.id), /odds/);
  const x = await fixture("lol-detail");
  x.data.event.markets[0].selections.pop();
  assert.throws(() => parseDetail(x, "lol", x.data.event.id), /Incomplete/);
  assert.throws(() => parseDetail(x, "lol", "1"), /route/);
  assert.throws(() =>
    safeUrl("https://www.betano.bet.br/api/odds/a/1/?token=secret"),
  );
});
test("Betano synthetic suspension inherits without inventing prices; absent flags remain unknown", async () => {
  const d = await fixture("cs2-detail");
  assert.equal(parseDetail(d, "cs2", d.data.event.id).suspended, null);
  d.data.event.markets[0].selections[0].price = null;
  assert.throws(() => parseDetail(d, "cs2", d.data.event.id), /missing price/);
  d.data.event.suspended = true;
  const e = parseDetail(d, "cs2", d.data.event.id);
  assert.equal(e.status, "suspended");
  assert.equal(e.markets[0].selections[0].suspended, true);
  assert.equal(e.markets[0].selections[0].odds, null);
  assert.equal(snapshots([e])[0].provider, "betano");
  assert.equal(snapshots([e])[2].map, 1);
});
test("Betano immutable snapshots, odds changes, scope isolation and restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "betano-journal-"));
  try {
    const d = await fixture("cs2-detail"),
      e = parseDetail(d, "cs2", d.data.event.id);
    const j = new MarketJournal(dir);
    await j.load();
    const a = {
      scope: "betano:detail:" + e.eventId,
      complete: true,
      matches: [e],
      fetchedAt: e.fetchedAt,
      source: d.source,
    };
    await j.ingest(a);
    assert.equal(await j.ingest(a), null);
    const b = structuredClone(a);
    b.fetchedAt = b.matches[0].fetchedAt = new Date(
      Date.parse(a.fetchedAt) + 60000,
    ).toISOString();
    for (const m of b.matches[0].markets) m.fetchedAt = b.fetchedAt;
    b.matches[0].markets[0].selections[0].odds = 1.2;
    const result = await j.ingest(b);
    assert.equal(
      result!.changes.filter((c) => c.type === "OddsChanged").length,
      1,
    );
    assert.equal(result!.changes[0].provider, "betano");
    const reloaded = new MarketJournal(dir);
    await reloaded.load();
    assert.equal(await reloaded.ingest(b), null);
    const lines = (await readFile(join(dir, "market-snapshots.ndjson"), "utf8"))
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.deepEqual(
      lines.map((x) => x.snapshots[0].odds),
      [1.13, 1.2],
    );
    const foreign = structuredClone(b);
    foreign.fetchedAt = foreign.matches[0].fetchedAt = new Date(
      Date.parse(b.fetchedAt) + 60000,
    ).toISOString();
    foreign.matches[0].provider = "bet365";
    await assert.rejects(j.ingest(foreign), /Provider/);
    assert.deepEqual(
      marketChanges([e], [], e.fetchedAt, true).map((c) => c.type),
      ["EventRemoved"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("Betano CDP capture persists only sports data and header/cookie names; 403 has no retry", async () => {
  const c = await fixture("cs2-detail");
  const bus = new EventEmitter() as any;
  let status = 200;
  bus.send = async (method: string) =>
    method === "Network.getResponseBody"
      ? {
          body: JSON.stringify({
            data: c.data,
            user: { password: "secret" },
            structureComponents: { token: "secret" },
          }),
        }
      : { cookies: [{ name: "technical", value: "secret" }] };
  const browser = new (BetanoBrowser as any)({ cdp: bus, sessionId: "own" });
  const action = async () => {
    const emit = (method: string, params: any) =>
      bus.emit("protocol", { method, params, sessionId: "own" });
    emit("Network.requestWillBeSent", {
      requestId: "1",
      request: {
        url: c.source.url,
        method: "GET",
        headers: { Cookie: "secret" },
      },
    });
    emit("Network.responseReceived", { requestId: "1", response: { status } });
    emit("Network.loadingFinished", { requestId: "1" });
  };
  const captured = await browser.capture(action, () => true, 1000);
  assert.ok(!JSON.stringify(captured).includes("secret"));
  assert.deepEqual(captured.cookieNames, ["technical"]);
  status = 403;
  await assert.rejects(
    browser.capture(action, () => true, 1000),
    /403/,
  );
});
test("Betano full competition coverage publishes atomically and survives restart; partial round rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "betano-store-"));
  try {
    const store = new BetanoStore(dir);
    await store.load();
    for (const [sport, count] of [
      ["cs2", 50],
      ["lol", 10],
      ["valorant", 8],
    ] as const) {
      const r = JSON.parse(
        await readFile(
          new URL("../fixtures/" + sport + "-round.json", import.meta.url),
          "utf8",
        ),
      );
      await store.ingest(r);
      assert.equal(store.listings.get(sport)?.matches.length, count);
      const partial = structuredClone(r);
      partial.captures = [];
      await assert.rejects(store.ingest(partial));
      assert.equal(store.listings.get(sport)?.matches.length, count);
    }
    const reloaded = new BetanoStore(dir);
    await reloaded.load();
    assert.equal(reloaded.listings.get("cs2")?.matches.length, 50);
    const d = await fixture("lol-detail");
    await store.ingest({ kind: "detail", esport: "lol", capture: d });
    assert.equal(
      store.details
        .get(d.data.event.id)
        ?.markets.filter((m) => m.category === "map_winner").length,
      5,
    );
    const wrong = structuredClone(d);
    wrong.data.markets[0].type = "all";
    await assert.rejects(
      store.ingest({ kind: "detail", esport: "lol", capture: wrong }),
      /scope/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("Betano real later response records MOUZ 1.13 to 1.11 and NRG 5.30 to 5.90", async () => {
  const before = await fixture("cs2-detail"),
    after = await fixture("cs2-detail-later");
  const a = parseDetail(before, "cs2", before.data.event.id),
    b = parseDetail(after, "cs2", after.data.event.id);
  assert.ok(b.fetchedAt > a.fetchedAt);
  const diff = marketChanges([a], [b], b.fetchedAt, true).filter(
    (c) => c.type === "OddsChanged",
  );
  assert.equal(diff.length, 2);
  assert.deepEqual(
    diff.map((c) => [(c.before as any).odds, (c.after as any).odds]),
    [
      [1.13, 1.11],
      [5.3, 5.9],
    ],
  );
});
