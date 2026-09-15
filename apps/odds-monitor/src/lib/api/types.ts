export interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  active: boolean;
  status: string;
  statusReason: string;
  eventCount: number;
  lastUpdatedAt: string | null;
  stale: boolean;
}
export interface Issue {
  id: string;
  type: string;
  severity: string;
  status?: string;
  eventId?: string | null;
  provider?: string | null;
  title?: string;
  message: string;
  detectedAt?: string;
}
export interface Selection {
  status: string;
  id: string;
  selectionId: string;
  name: string;
  odds: number | null;
  suspended: boolean | null;
  inPlay: boolean | null;
  fetchedAt: string | null;
}
export interface Market {
  status: string;
  id: string;
  providerMarketId: string;
  provider: string;
  category: string;
  name: string;
  mapNumber: number | null;
  suspended: boolean | null;
  selections: Selection[];
}
export interface EventProvider {
  id: string;
  provider: string;
  active: boolean;
  statusReason: string;
  providerEventId: string;
  rawTeamA: string;
  rawTeamB: string;
  rawTournament: string;
  startsAt: string;
  lastUpdatedAt: string;
  status: string;
  matchWinner: { teamA: number | null; teamB: number | null; status?: string };
  issues: Issue[];
  markets?: Market[];
}
export interface EventRow {
  id: string;
  canonicalId: string | null;
  esport: string;
  tournament: string;
  teamA: string;
  teamB: string;
  startsAt: string;
  matching: {
    status:
      | "matched"
      | "partial"
      | "unmatched"
      | "low_confidence"
      | "manual"
      | "not_applicable";
    confidence: number;
    providerCount: number;
    expectedProviderCount: number;
  };
  providers: EventProvider[];
  issues: Issue[];
}
export interface Detail extends EventRow {
  markets: Market[];
}
export interface Overview {
  generatedAt: string;
  health: {
    status: string;
    events: number;
    matched: number;
    partial: number;
    unmatched: number;
    notApplicable: number;
    issues: number;
  };
  providers: Provider[];
}
export interface EventPage {
  items: EventRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}
export interface History {
  eventId: string;
  truncated: boolean;
  series: {
    provider: string;
    market: { id: string; category: string; mapNumber: number | null };
    selection: string;
    selectionId: string;
    points: {
      odds: number | null;
      fetchedAt: string;
      suspended: boolean | null;
      inPlay: boolean | null;
    }[];
  }[];
}
export type Filters = Record<
  | "search"
  | "esport"
  | "status"
  | "start"
  | "provider"
  | "attentionOnly"
  | "page"
  | "limit",
  string
>;
