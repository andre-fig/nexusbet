import type { Match, Parsed } from "../types/model.js";
import { listMarkets } from "./list.mapper.js";
import type { NormalizedEvent } from "../../../shared/domain/normalized-event.js";
import { names } from "../../../shared/utils/names.js";
export function normalizedBet365(
  matches: Match[],
  provenance: Parsed["provenance"],
): NormalizedEvent[] {
  return listMarkets({ matches, provenance }).map((e) => {
    const original = matches.find((m) => m.eventId === e.eventId)!;
    return {
      ...e,
      tournament: original.tournament,
      startsAt: original.startsAt,
      status: original.status,
      ...names(e.teamA, e.teamB, e.esport),
      provenance: provenance[e.eventId],
    };
  });
}
