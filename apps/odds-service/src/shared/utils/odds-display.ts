const oddsFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Presentation only: numeric odds remain unchanged in domain and persistence. */
export function formatOdds(value: number): string {
  return oddsFormatter.format(value);
}

export function displayOdds(value: number | null | undefined): string | null {
  return value == null ? null : formatOdds(value);
}

export function presentEvent<
  T extends { markets: { selections: { odds: number | null }[] }[] },
>(event: T) {
  return {
    ...event,
    markets: event.markets.map((market) => ({
      ...market,
      selections: market.selections.map((selection) => ({
        ...selection,
        displayOdds: displayOdds(selection.odds),
      })),
    })),
  };
}
