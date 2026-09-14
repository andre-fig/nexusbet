import type { Parsed } from "../types/model.js";
import type { DetailedMatch } from "../../../shared/domain/market-model.js";
export function listMarkets(parsed: Parsed): DetailedMatch[] {
  return parsed.matches.map((e) => {
    const p = parsed.provenance[e.eventId];
    return {
      provider: e.provider,
      esport: e.esport,
      eventId: e.eventId,
      teamA: e.teamA,
      teamB: e.teamB,
      fetchedAt: e.fetchedAt,
      inPlay: p.inPlay,
      suspended: null,
      markets: e.markets.map((m) => ({
        marketId: m.marketId,
        rawMarketId: p.rawMarketId,
        category: m.market,
        name: "Para Ganhar",
        groupId: null,
        groupName: null,
        map: null,
        line: null,
        suspended: p.marketSuspended,
        inPlay: p.inPlay,
        raw: {},
        selections: m.selections.map((s) => ({
          ...s,
          line: null,
          side: null,
          suspended: p.marketSuspended ? null : false,
          inPlay: p.inPlay,
          raw: {},
        })),
      })),
    };
  });
}
