import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeMarkets, type AnalyticsProvider } from "../market-analytics.js";

function provider(
  name: string,
  oddA: number | null,
  oddB: number | null,
  options: {
    active?: boolean;
    status?: string;
    marketStatus?: string;
    selectionStatus?: string;
    category?: string;
    mapNumber?: number | null;
    secondSelection?: string;
  } = {},
): AnalyticsProvider {
  return {
    provider: name,
    active: options.active ?? true,
    status: options.status ?? "healthy",
    markets: [
      {
        id: `${name}:market`,
        category: options.category ?? "match_winner",
        mapNumber: options.mapNumber ?? null,
        line: null,
        period: null,
        status: options.marketStatus ?? "healthy",
        selections: [
          {
            id: `${name}:alpha`,
            name: "Alpha",
            odds: oddA,
            status: options.selectionStatus ?? "healthy",
          },
          {
            id: `${name}:beta`,
            name: options.secondSelection ?? "Beta",
            odds: oddB,
            status: options.selectionStatus ?? "healthy",
          },
        ],
      },
    ],
  };
}
function analyze(
  providers: AnalyticsProvider[],
  overrides: Partial<Parameters<typeof analyzeMarkets>[0]> = {},
) {
  return analyzeMarkets({
    canonicalId: "canonical:1",
    matchingStatus: "matched",
    esport: "cs2",
    teamA: "Alpha",
    teamB: "Beta",
    outlierThresholdPercent: 10,
    providers,
    ...overrides,
  });
}

test("best price chooses the highest valid odd and breaks ties by provider name", () => {
  const [result] = analyze([
    provider("bet365", 1.72, 1.85),
    provider("betano", 1.75, 1.9),
    provider("superbet", 1.68, 1.8),
    provider("blaze", 1.8, 1.88),
    provider("estrelabet", 1.74, 1.87),
  ]);
  assert.equal(result.bestPrices[0].provider, "blaze");
  assert.equal(result.bestPrices[0].odds, 1.8);
  assert.equal(result.bestPrices[0].displayOdds, "1,80");
  assert.equal(result.bestPrices[0].nextBestOdds, 1.75);
  const [tie] = analyze([
    provider("betano", 1.8, 1.9),
    provider("blaze", 1.8, 1.9),
  ]);
  assert.equal(tie.bestPrices[0].provider, "betano");
  assert.equal(tie.bestPrices[0].nextBestOdds, 1.8);
});

test("disabled, stale, null and invalid odds do not enter best price or outliers", () => {
  const [result] = analyze([
    provider("bet365", 1.72, 1.85),
    provider("betano", 1.75, 1.9),
    provider("blaze", 5, 5, { active: false }),
    provider("superbet", 4, 4, { status: "stale" }),
    provider("estrelabet", null, 2),
    provider("invalid", 1, 2),
  ]);
  assert.deepEqual(result.marketIds.sort(), ["bet365:market", "betano:market"]);
  assert.equal(result.bestPrices[0].provider, "betano");
  assert.equal(result.outliers.length, 0);
});

test("outlier uses the median and the configurable threshold without blaming providers", () => {
  const providers = [
    provider("bet365", 1.7, 1.9),
    provider("betano", 1.72, 1.9),
    provider("superbet", 1.69, 1.9),
    provider("blaze", 2.05, 1.9),
    provider("estrelabet", 1.71, 1.9),
  ];
  const [result] = analyze(providers);
  assert.equal(result.outliers.length, 1);
  assert.equal(result.outliers[0].provider, "blaze");
  assert.equal(result.outliers[0].medianOdds, 1.71);
  assert.equal(result.outliers[0].deviationPercent, 19.88);
  assert.match(result.outliers[0].tooltip, /Mediana dos providers: 1,71/);
  assert.doesNotMatch(result.outliers[0].tooltip, /errad[ao]/i);
  assert.equal(
    analyze(providers, { outlierThresholdPercent: 25 })[0].outliers.length,
    0,
  );
});

test("arbitrage computes inverse sum, stake split and equal theoretical returns", () => {
  const [result] = analyze([
    provider("bet365", 2.2, 1.85),
    provider("betano", 2.05, 2.1),
  ]);
  const arb = result.arbitrage!;
  assert.equal(arb.exists, true);
  assert.ok(Math.abs(arb.inverseSum - (1 / 2.2 + 1 / 2.1)) < 1e-12);
  assert.equal(arb.marginPercent, 7.44);
  assert.equal(arb.legs[0].provider, "bet365");
  assert.equal(arb.legs[1].provider, "betano");
  assert.equal(arb.legs[0].stakeAmount + arb.legs[1].stakeAmount, 100);
  assert.ok(
    Math.abs(arb.legs[0].stakeAmount * 2.2 - arb.legs[1].stakeAmount * 2.1) <
      0.03,
  );
  assert.equal(arb.expectedReturn, 107.44);
  assert.match(arb.tooltip, /Para R\$100/);
  assert.match(arb.tooltip, /Risco operacional ainda existe/);
});

test("no arbitrage is reported when the best inverse sum is at least one", () => {
  const [result] = analyze([
    provider("bet365", 1.7, 1.8),
    provider("betano", 1.72, 1.75),
  ]);
  assert.equal(result.arbitrage, null);
});

test("incomplete, multi-result, stale and incompatible markets cannot form arbitrage", () => {
  const healthy = provider("bet365", 2.2, 1.8);
  const other = provider("betano", 1.8, 2.1);
  const incomplete = provider("blaze", 2.3, null);
  assert.equal(analyze([healthy, incomplete]).length, 0);
  assert.equal(
    analyze([
      healthy,
      provider("betano", 1.8, 2.1, { marketStatus: "incomplete" }),
    ]).length,
    0,
  );
  const threeResults = structuredClone(other);
  threeResults.markets[0].selections.push({
    id: "betano:draw",
    name: "Draw",
    odds: 3.5,
    status: "healthy",
  });
  assert.equal(analyze([healthy, threeResults]).length, 0);
  assert.equal(
    analyze([healthy, provider("betano", 1.8, 2.1, { marketStatus: "stale" })])
      .length,
    0,
  );
  assert.equal(
    analyze([
      healthy,
      provider("betano", 1.8, 2.1, { selectionStatus: "stale" }),
    ]).length,
    0,
  );
  assert.equal(
    analyze([
      healthy,
      provider("betano", 1.8, 2.1, { secondSelection: "Gamma" }),
    ]).length,
    0,
  );
  assert.equal(analyze([healthy, other], { canonicalId: null }).length, 0);
  assert.equal(
    analyze([healthy, other], { matchingStatus: "unmatched" }).length,
    0,
  );
});

test("map numbers and market dimensions must agree before comparison", () => {
  const mapOne = provider("bet365", 2.2, 1.85, {
    category: "map_winner",
    mapNumber: 1,
  });
  const mapTwo = provider("betano", 1.8, 2.1, {
    category: "map_winner",
    mapNumber: 2,
  });
  assert.equal(analyze([mapOne, mapTwo]).length, 0);
  const sameMap = provider("betano", 1.8, 2.1, {
    category: "map_winner",
    mapNumber: 1,
  });
  assert.equal(analyze([mapOne, sameMap]).length, 1);
  sameMap.markets[0].period = "overtime";
  assert.equal(analyze([mapOne, sameMap]).length, 0);
  sameMap.markets[0].period = null;
  sameMap.markets[0].line = 1.5;
  assert.equal(analyze([mapOne, sameMap]).length, 0);
});
