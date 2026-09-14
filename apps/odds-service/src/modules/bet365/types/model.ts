import type { Esport, Status, Source } from "../../../shared/types/common.js";
export type { Esport, Status, Source } from "../../../shared/types/common.js";
export interface Match {
  provider: "bet365";
  esport: Esport;
  eventId: string;
  tournament: string;
  teamA: string;
  teamB: string;
  startsAt: string;
  status: Status;
  markets: {
    marketId: string;
    market: string;
    selections: { selectionId: string; name: string; odds: number }[];
  }[];
  fetchedAt: string;
}
export interface Capture {
  provider: "bet365";
  esport: Esport;
  capturedAt: string;
  source: Source;
  body: string;
}
export interface Parsed {
  matches: Match[];
  provenance: Record<
    string,
    {
      competitionId: string;
      pageEventId: string;
      rawMarketId: string;
      inPlay: boolean;
      marketSuspended: boolean;
    }
  >;
}
export const codes: Record<Esport, string> = {
  cs2: "2",
  lol: "3",
  valorant: "8",
};
