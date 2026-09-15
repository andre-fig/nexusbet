import { test } from "node:test";
import assert from "node:assert/strict";
import type { DetailedMatch } from "../../../shared/domain/market-model.js";
import {
  displayOdds,
  formatOdds,
  presentEvent,
} from "../../../shared/utils/odds-display.js";

test("odds display always has two pt-BR decimal places", () => {
  for (const [value, expected] of [
    [1.5556, "1,56"],
    [2, "2,00"],
    [2.9, "2,90"],
    [1.521, "1,52"],
    [1.005, "1,01"],
  ] as const)
    assert.equal(formatOdds(value), expected);
  assert.equal(displayOdds(null), null);
  assert.equal(displayOdds(undefined), null);
});

test("API event presentation retains original numeric odds and null", () => {
  const event = {
    provider: "superbet",
    esport: "cs2",
    eventId: "external-1",
    teamA: "A",
    teamB: "B",
    inPlay: false,
    suspended: false,
    fetchedAt: "2026-09-15T00:00:00.000Z",
    markets: [
      {
        marketId: "winner",
        rawMarketId: "winner",
        category: "match_winner",
        name: "Winner",
        groupId: null,
        groupName: null,
        map: null,
        line: null,
        suspended: false,
        inPlay: false,
        raw: {},
        selections: [1.5556, null].map((odds, index) => ({
          selectionId: String(index),
          name: String(index),
          odds,
          line: null,
          side: null,
          suspended: false,
          inPlay: false,
          raw: {},
        })),
      },
    ],
  } satisfies DetailedMatch;
  const presented = presentEvent(event);
  assert.equal(presented.markets[0].selections[0].odds, 1.5556);
  assert.equal(presented.markets[0].selections[0].displayOdds, "1,56");
  assert.equal(presented.markets[0].selections[1].odds, null);
  assert.equal(presented.markets[0].selections[1].displayOdds, null);
  assert.equal("displayOdds" in event.markets[0].selections[0], false);
});
