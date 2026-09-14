import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BrowserFeed,
  safeFeedUrl,
  pageUrl,
  origin,
} from "../transport/browser-feed.js";
import { codes, type Esport } from "../types/model.js";
import { parseCapture } from "../parsers/list.parser.js";
import { couponStructure } from "../parsers/protocol.parser.js";
test("source URLs reject sensitive/foreign parameters and preserve provider routes", () => {
  assert.equal(
    pageUrl("#AC#B151#C21168549#D19#E26688438#F19#"),
    origin + "/#/AC/B151/C21168549/D19/E26688438/F19/",
  );
  for (const u of [
    "https://example.org/contentdata/othersportsmatchmarketscontentapi/list",
    origin + "/login",
    origin + "/contentdata/othersportsmatchmarketscontentapi/list?token=secret",
  ])
    assert.throws(() => safeFeedUrl(u));
  assert.throws(() => pageUrl("https://example.org"));
});
test("synthetic coupon structure preserves unknown markets, metadata and suspended selections without OD", () => {
  const body =
    "F|EV;ID=1;|MG;ID=2;NA=Future Group;|MA;ID=3;NA=Future Market;X=a=b;|PA;ID=4;SU=1;|ZZ;X=unknown;|MG;ID=5;NA=Next;|PA;ID=6;|";
  const p = couponStructure(body);
  assert.equal(p.groups[0].markets[0].selections[0].SU, "1");
  assert.equal(p.groups[0].markets[0].fields.X, "a=b");
  assert.equal(p.groups[0].markets[0].records[1].type, "ZZ");
  assert.equal(p.groups[1].records[0].fields.ID, "6");
  assert.equal(p.records.length, 7);
  assert.throws(() => couponStructure(""));
});
test(
  "offline Chrome: intercept native frontend responses for three real listing fixtures without DevTools",
  { skip: process.env.BROWSER_TESTS !== "1" },
  async () => {
    const client = await BrowserFeed.open();
    try {
      let game: Esport = "cs2";
      let invalid = false;
      await client.page.route("**/*", async (route) => {
        const u = new URL(route.request().url());
        const c = JSON.parse(
          await readFile(
            new URL(`../fixtures/${game}.json`, import.meta.url),
            "utf8",
          ),
        );
        if (u.pathname === "/")
          await route.fulfill({
            contentType: "text/html",
            body: `<script>function load(){const u=new URL(${JSON.stringify(c.source.url)});u.searchParams.set('pd','#'+location.hash.slice(2).split('/').filter(Boolean).join('#')+'#');fetch(u)};addEventListener('hashchange',load);load()</script>`,
          });
        else if (
          u.pathname === "/contentdata/othersportsmatchmarketscontentapi/list"
        )
          await route.fulfill({
            contentType: "text/plain",
            body: invalid ? "" : c.body,
          });
        else await route.abort();
      });
      for (game of ["cs2", "lol", "valorant"] as const) {
        const capture = await client.capture(
          game,
          `#AC#B151#C1#D50#E${codes[game]}#F163#`,
          "/contentdata/othersportsmatchmarketscontentapi/list",
          5000,
        );
        assert.equal(capture.source.capture, "playwright-response");
        assert.equal(capture.source.authenticated, false);
        assert.ok(parseCapture(capture).matches.length > 0);
      }
      game = "valorant";
      invalid = true;
      await assert.rejects(
        client.capture(
          game,
          `#AC#B151#C1#D50#E8#F163#`,
          "/contentdata/othersportsmatchmarketscontentapi/list",
          5000,
        ),
        /Empty|Unable to read feed body/,
      );
    } finally {
      await client.close();
    }
  },
);
