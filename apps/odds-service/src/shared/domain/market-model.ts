import type { Esport, Source } from "../types/common.js";
export type RawFields = Record<string, string>;
export interface Selection {
  columnName?: string | null;
  rowName?: string | null;
  selectionId: string;
  name: string;
  odds: number | null;
  line: number | null;
  side: "over" | "under" | null;
  suspended: boolean | null;
  inPlay: boolean | null;
  raw: RawFields;
}
export interface Market {
  fetchedAt?: string;
  round?: number | null;
  period?: string | null;
  marketId: string;
  rawMarketId: string;
  category: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
  map: number | null;
  line: number | null;
  suspended: boolean | null;
  inPlay: boolean | null;
  selections: Selection[];
  raw: RawFields;
}
export interface DetailedMatch {
  provider: "bet365" | "betano" | "superbet" | "blaze" | "estrelabet";
  esport: Esport;
  eventId: string;
  teamA: string;
  teamB: string;
  markets: Market[];
  inPlay: boolean | null;
  suspended: boolean | null;
  fetchedAt: string;
}
export interface OddsSnapshot {
  provider: "bet365" | "betano" | "superbet" | "blaze" | "estrelabet";
  map: number | null;
  eventId: string;
  marketId: string;
  selectionId: string;
  odds: number | null;
  line: number | null;
  suspended: boolean | null;
  inPlay: boolean | null;
  fetchedAt: string;
}
export type ChangeType =
  | "OddsChanged"
  | "MarketSuspended"
  | "MarketReopened"
  | "MarketAdded"
  | "MarketRemoved"
  | "EventAdded"
  | "EventRemoved";
export interface MarketChange {
  provider?: "bet365" | "betano" | "superbet" | "blaze" | "estrelabet";
  type: ChangeType;
  eventId: string;
  marketId?: string;
  selectionId?: string;
  fetchedAt: string;
  before?: unknown;
  after?: unknown;
}
export interface MarketBatch {
  scope: string;
  complete: boolean;
  matches: DetailedMatch[];
  fetchedAt: string;
  source: Source;
}
