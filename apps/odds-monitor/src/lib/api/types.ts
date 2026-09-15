import type { HealthStatus, ProviderStatus } from "./status";
import type { MatchingStatus } from "./matching-status";

export interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  active: boolean;
  status: ProviderStatus;
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
  displayOdds: string | null;
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
  analytics?: MarketAnalytics | null;
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
export interface Arbitrage {
  exists: boolean;
  inverseSum: number;
  marginPercent: number;
  displayMarginPercent: string;
  stakeReference: number;
  expectedReturn: number;
  tooltip: string;
  legs: [
    {
      side: "teamA" | "teamB";
      selection: string;
      selectionId: string;
      marketId: string;
      provider: string;
      odds: number;
      displayOdds: string;
      stakePercent: number;
      stakeAmount: number;
    },
    {
      side: "teamA" | "teamB";
      selection: string;
      selectionId: string;
      marketId: string;
      provider: string;
      odds: number;
      displayOdds: string;
      stakePercent: number;
      stakeAmount: number;
    },
  ];
}
export interface MarketAnalytics {
  category: string;
  mapNumber: number | null;
  marketIds: string[];
  bestPrices: BestPrice[];
  outliers: Outlier[];
  arbitrage: Arbitrage | null;
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
  matchWinner: {
    teamA: number | null;
    teamB: number | null;
    displayTeamA: string | null;
    displayTeamB: string | null;
    status?: string;
  };
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
    status: MatchingStatus;
    confidence: number;
    providerCount: number;
    expectedProviderCount: number;
  };
  providers: EventProvider[];
  issues: Issue[];
  analytics?: MarketAnalytics[];
}
export interface Detail extends EventRow {
  markets: Market[];
}
export interface Overview {
  generatedAt: string;
  health: {
    status: HealthStatus;
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
      displayOdds: string | null;
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
