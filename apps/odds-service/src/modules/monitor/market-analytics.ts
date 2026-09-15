import { canonicalTeamName } from "../matching/team-aliases.js";
import { displayOdds } from "../../shared/utils/odds-display.js";
import type { Esport } from "../../shared/types/common.js";

export interface AnalyticsSelection {
  id: string;
  name: string;
  odds: number | null;
  status: string;
}
export interface AnalyticsMarket {
  id: string;
  category: string;
  mapNumber: number | null;
  line: unknown;
  period: string | null;
  status: string;
  selections: AnalyticsSelection[];
}
export interface AnalyticsProvider {
  provider: string;
  active: boolean;
  status: string;
  markets: AnalyticsMarket[];
}
export interface BestPrice {
  side: "teamA" | "teamB";
  selection: string;
  selectionId: string;
  marketId: string;
  provider: string;
  odds: number;
  displayOdds: string;
  nextBestOdds: number | null;
  displayNextBestOdds: string | null;
  tooltip: string;
}
export interface Outlier {
  side: "teamA" | "teamB";
  selection: string;
  selectionId: string;
  marketId: string;
  provider: string;
  odds: number;
  displayOdds: string;
  medianOdds: number;
  displayMedianOdds: string;
  deviationPercent: number;
  tooltip: string;
}
export interface ArbitrageLeg {
  side: "teamA" | "teamB";
  selection: string;
  selectionId: string;
  marketId: string;
  provider: string;
  odds: number;
  displayOdds: string;
  stakePercent: number;
  stakeAmount: number;
}
export interface Arbitrage {
  exists: boolean;
  inverseSum: number;
  marginPercent: number;
  displayMarginPercent: string;
  stakeReference: number;
  expectedReturn: number;
  legs: [ArbitrageLeg, ArbitrageLeg];
  tooltip: string;
}
export interface MarketAnalytics {
  category: string;
  mapNumber: number | null;
  marketIds: string[];
  bestPrices: BestPrice[];
  outliers: Outlier[];
  arbitrage: Arbitrage | null;
}

type Candidate = {
  side: "teamA" | "teamB";
  selection: string;
  selectionId: string;
  marketId: string;
  provider: string;
  odds: number;
};
const round = (value: number) => Math.round(value * 100) / 100;
const percent = (value: number) =>
  value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
const money = (value: number) =>
  value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const providerName = (value: string) => value[0].toUpperCase() + value.slice(1);

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Read-only comparison of fresh, equivalent canonical markets. */
export function analyzeMarkets(input: {
  canonicalId: string | null;
  matchingStatus: string;
  esport: Esport;
  teamA: string;
  teamB: string;
  providers: AnalyticsProvider[];
  outlierThresholdPercent: number;
}): MarketAnalytics[] {
  if (
    !input.canonicalId ||
    !["matched", "partial"].includes(input.matchingStatus) ||
    input.teamA === input.teamB
  )
    return [];
  const sides = {
    teamA: canonicalTeamName(input.teamA, input.esport),
    teamB: canonicalTeamName(input.teamB, input.esport),
  };
  if (sides.teamA === sides.teamB) return [];
  const groups = new Map<
    string,
    { market: AnalyticsMarket; provider: string }[]
  >();
  for (const provider of input.providers) {
    if (!provider.active || provider.status !== "healthy") continue;
    for (const market of provider.markets) {
      if (
        market.status !== "healthy" ||
        !["match_winner", "map_winner"].includes(market.category) ||
        (market.category === "map_winner" &&
          (market.mapNumber === null ||
            market.mapNumber < 1 ||
            market.mapNumber > 3))
      )
        continue;
      const key = JSON.stringify([
        market.category,
        market.mapNumber,
        market.period ?? null,
        market.line == null ? null : String(market.line),
      ]);
      const group = groups.get(key) ?? [];
      group.push({ market, provider: provider.provider });
      groups.set(key, group);
    }
  }
  const results: MarketAnalytics[] = [];
  for (const entries of groups.values()) {
    const providerCounts = new Map<string, number>();
    for (const entry of entries)
      providerCounts.set(
        entry.provider,
        (providerCounts.get(entry.provider) ?? 0) + 1,
      );
    const valid = entries.flatMap(({ market, provider }) => {
      if (providerCounts.get(provider) !== 1 || market.selections.length !== 2)
        return [];
      const candidates: Candidate[] = [];
      for (const selection of market.selections) {
        const normalized = canonicalTeamName(selection.name, input.esport);
        const side =
          normalized === sides.teamA
            ? "teamA"
            : normalized === sides.teamB
              ? "teamB"
              : null;
        if (
          !side ||
          selection.status !== "healthy" ||
          selection.odds === null ||
          !Number.isFinite(selection.odds) ||
          selection.odds <= 1
        )
          return [];
        candidates.push({
          side,
          selection: side === "teamA" ? input.teamA : input.teamB,
          selectionId: selection.id,
          marketId: market.id,
          provider,
          odds: selection.odds,
        });
      }
      if (candidates[0].side === candidates[1].side) return [];
      return candidates;
    });
    const providerCount = new Set(valid.map((candidate) => candidate.provider))
      .size;
    if (providerCount < 2) continue;
    const bySide = {
      teamA: valid.filter((candidate) => candidate.side === "teamA"),
      teamB: valid.filter((candidate) => candidate.side === "teamB"),
    };
    if (
      bySide.teamA.length !== providerCount ||
      bySide.teamB.length !== providerCount
    )
      continue;
    const bestPrices: BestPrice[] = [];
    const outliers: Outlier[] = [];
    for (const side of ["teamA", "teamB"] as const) {
      const candidates = [...bySide[side]].sort(
        (a, b) => b.odds - a.odds || a.provider.localeCompare(b.provider),
      );
      const best = candidates[0];
      const nextBestOdds = candidates[1]?.odds ?? null;
      bestPrices.push({
        ...best,
        displayOdds: displayOdds(best.odds)!,
        nextBestOdds,
        displayNextBestOdds: displayOdds(nextBestOdds),
        tooltip: `Best price: ${providerName(best.provider)} oferece ${displayOdds(best.odds)} para ${best.selection}; a próxima melhor é ${displayOdds(nextBestOdds)}. Maior odd disponível entre providers válidos.`,
      });
      if (candidates.length < 3) continue;
      const medianOdds = median(candidates.map((candidate) => candidate.odds));
      for (const candidate of candidates) {
        const deviation = ((candidate.odds - medianOdds) / medianOdds) * 100;
        if (Math.abs(deviation) <= input.outlierThresholdPercent) continue;
        outliers.push({
          ...candidate,
          displayOdds: displayOdds(candidate.odds)!,
          medianOdds,
          displayMedianOdds: displayOdds(medianOdds)!,
          deviationPercent: round(deviation),
          tooltip: `${providerName(candidate.provider)} oferece ${displayOdds(candidate.odds)}. Mediana dos providers: ${displayOdds(medianOdds)}. Diferença: ${deviation >= 0 ? "+" : ""}${percent(deviation)}%. Esta odd diverge das demais; não indica erro do provider.`,
        });
      }
    }
    const [bestA, bestB] = bestPrices;
    const inverseSum = 1 / bestA.odds + 1 / bestB.odds;
    let arbitrage: Arbitrage | null = null;
    if (inverseSum < 1) {
      const stakeReference = 100;
      const stakeA = (stakeReference * (1 / bestA.odds)) / inverseSum;
      const stakeB = stakeReference - stakeA;
      const expectedReturn = stakeReference / inverseSum;
      const legs: [ArbitrageLeg, ArbitrageLeg] = [
        { ...bestA, stakePercent: round(stakeA), stakeAmount: round(stakeA) },
        { ...bestB, stakePercent: round(stakeB), stakeAmount: round(stakeB) },
      ];
      const marginPercent = round((1 / inverseSum - 1) * 100);
      arbitrage = {
        exists: true,
        inverseSum,
        marginPercent,
        displayMarginPercent: `${money(marginPercent)}%`,
        stakeReference,
        expectedReturn: round(expectedReturn),
        legs,
        tooltip: `${bestA.selection} @ ${displayOdds(bestA.odds)} na ${providerName(bestA.provider)} + ${bestB.selection} @ ${displayOdds(bestB.odds)} na ${providerName(bestB.provider)} formam arbitragem teórica de ${money(marginPercent)}%. Para R$100: R$${money(stakeA)} em ${bestA.selection}; R$${money(stakeB)} em ${bestB.selection}; retorno teórico ~R$${money(expectedReturn)}. Risco operacional ainda existe: mudança de odds, limites, void ou regras diferentes.`,
      };
    }
    results.push({
      category: entries[0].market.category,
      mapNumber: entries[0].market.mapNumber,
      marketIds: [...new Set(valid.map((candidate) => candidate.marketId))],
      bestPrices,
      outliers,
      arbitrage,
    });
  }
  return results;
}
