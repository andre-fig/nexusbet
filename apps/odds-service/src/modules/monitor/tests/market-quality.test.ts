import { test } from "node:test";
import assert from "node:assert/strict";
import { incompleteWinnerMarket } from "../../../shared/utils/market-quality.js";
import type { Market } from "../../../shared/domain/market-model.js";
import { analyzeMarkets, type AnalyticsProvider } from "../market-analytics.js";

const selection = (name: string, odds: number | null) =>
  ({
    selectionId: name,
    name,
    odds,
    line: null,
    side: null,
    suspended: false,
    inPlay: false,
    raw: {},
  }) as const;
const market = (category: string, map: number | null, odds: number | null) =>
  ({
    category,
    map,
    selections: [selection("Alpha", odds)],
  }) as Pick<Market, "category" | "map" | "selections">;

test("observed match and map winners with one valid odd are incomplete; absent markets have no issue", () => {
  assert.equal(
    incompleteWinnerMarket(market("match_winner", null, 1.42), "Alpha", "Beta"),
    true,
  );
  assert.equal(
    incompleteWinnerMarket(market("map_winner", 1, 1.42), "Alpha", "Beta"),
    true,
  );
  assert.equal(
    incompleteWinnerMarket(market("map_winner", 3, null), "Alpha", "Beta"),
    true,
  );
  assert.equal(
    incompleteWinnerMarket(market("map_winner", 4, 1.42), "Alpha", "Beta"),
    true,
  );
  const complete = market("map_winner", 1, 1.42);
  complete.selections.push(selection("Beta", 2.1));
  assert.equal(incompleteWinnerMarket(complete, "Alpha", "Beta"), false);
});

test("an absent, stale or incomplete map market contributes no odds but other maps still compare", () => {
  const provider = (
    name: string,
    mapNumber: number,
    status = "healthy",
  ): AnalyticsProvider => ({
    provider: name,
    active: true,
    status: "healthy",
    markets: [
      {
        id: `${name}:${mapNumber}`,
        category: "map_winner",
        mapNumber,
        line: null,
        period: null,
        status,
        selections: [
          {
            id: `${name}:${mapNumber}:a`,
            name: "Alpha",
            odds: 2.2,
            status: "healthy",
          },
          {
            id: `${name}:${mapNumber}:b`,
            name: "Beta",
            odds: 2.1,
            status: "healthy",
          },
        ],
      },
    ],
  });
  const result = analyzeMarkets({
    canonicalId: "canonical",
    matchingStatus: "matched",
    esport: "cs2",
    teamA: "Alpha",
    teamB: "Beta",
    outlierThresholdPercent: 10,
    providers: [
      provider("superbet", 1),
      provider("blaze", 1),
      provider("superbet", 2, "stale"),
      provider("blaze", 2),
      provider("superbet", 3, "incomplete"),
      provider("blaze", 3),
    ],
  });
  assert.deepEqual(
    result.map((m) => m.mapNumber),
    [1],
  );
  assert.equal(result[0].arbitrage?.exists, true);
});
