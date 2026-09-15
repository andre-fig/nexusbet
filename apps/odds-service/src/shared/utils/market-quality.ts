import type { Market } from "../domain/market-model.js";

export function validSelectionCount(
  market: Pick<Market, "selections">,
): number {
  return market.selections.filter(
    (selection) =>
      selection.odds !== null &&
      Number.isFinite(selection.odds) &&
      selection.odds > 1,
  ).length;
}

export function incompleteWinnerMarket(
  market: Pick<Market, "category" | "selections">,
  teamA: string,
  teamB: string,
): boolean {
  return (
    (market.category === "match_winner" || market.category === "map_winner") &&
    !!teamA.trim() &&
    !!teamB.trim() &&
    teamA.trim() !== teamB.trim() &&
    validSelectionCount(market) < 2
  );
}
