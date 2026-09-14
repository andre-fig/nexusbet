export type GameCategory = 'ALL' | 'CS2' | 'LoL' | 'VAL';

export type StatusFilter = 'ALL' | 'ATTENTION' | 'MATCHED' | 'PARTIAL' | 'UNMATCHED';

export type TimeFilter = 'TODAY' | '24H' | '7D';

export interface ProviderMetric {
  id: string;
  name: string;
  code: string;
  status: 'Healthy' | 'Stale Feed' | 'Benchmark';
  isStale?: boolean;
  eventCount: number;
  lastUpdate: string;
  percent: number;
}

export interface OperationalOddsEvent {
  id: string;
  game: 'CS2' | 'LoL' | 'VAL';
  matchName: string;
  tournament: string;
  startText: string;
  bet365: {
    home: number | null;
    away: number | null;
    lastUpdate: string;
    isInvalid?: boolean;
    invalidReason?: string;
  };
  betano: {
    home: number | null;
    away: number | null;
    lastUpdate: string;
    isMissing?: boolean;
    isStale?: boolean;
    staleDuration?: string;
  };
  superbet: {
    home: number | null;
    away: number | null;
    lastUpdate: string;
    isDivergent?: boolean;
    deltaText?: string;
  };
  pinnacle: {
    home: number | null;
    away: number | null;
    lastUpdate: string;
  };
  status: 'MATCHED' | 'ATTENTION' | 'PARTIAL' | 'UNMATCHED';
  statusBadge: {
    label: string;
    variant: 'matched' | 'divergence' | 'partial' | 'unmatched' | 'confidence' | 'invalid' | 'stale';
    detail?: string;
  };
  arbRisk?: boolean;
  isIsolated?: boolean;
  actionText: string;
  actionType: 'details' | 'inspect' | 'match' | 'review' | 'purge';
}

export interface IssueItem {
  id: string;
  type: 'ODDS DIVERGENCE' | 'INVALID DATA' | 'STALE PROVIDER' | 'UNMATCHED' | 'PARTIAL MATCH';
  gameInfo: string;
  title: string;
  description: string;
  timeAgo: string;
  actionText: string;
  eventId?: string;
}

export interface MarketOddsRow {
  selectionName: string;
  bet365: number | string;
  betano: number | string;
  superbet: number | string;
  pinnacle: number | string;
  consensus: string;
  delta: string;
  isBetanoUnavailable?: boolean;
  isFeedIncomplete?: boolean;
  bestProvider?: 'bet365' | 'betano' | 'superbet' | 'pinnacle';
}

export interface PriorityMarketGroup {
  name: string;
  rows: MarketOddsRow[];
}

export interface IngestedFeed {
  provider: string;
  code: string;
  dotColorClass: string;
  rawTeams: {
    home: string;
    away: string;
    normalizedHome?: string;
    normalizedAway?: string;
  };
  tournamentRaw: string;
  startTime: string;
  status: string;
  lastUpdate: string;
}
