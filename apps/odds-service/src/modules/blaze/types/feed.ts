import type { Source, Esport } from "../../../shared/types/common.js";
export const OFFER_ORIGIN = "https://api-31-sp-c7818b61-584.sptpub.com";
export const BRAND = "2480840120849276929";
export const PREMATCH_PATH = `/api/v4/prematch/brand/${BRAND}/pt-BR/`;
export const DESCRIPTIONS_PATH = `/api/v3/descriptions/brand/${BRAND}/markets/pt-BR`;
export const SPORTS: Record<Esport, string> = {
  cs2: "109",
  lol: "110",
  valorant: "194",
};
export type ObjectValue = Record<string, unknown>;
export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Expected Blaze feed object");
  return value as ObjectValue;
}
export function id(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw Error("Expected Blaze string ID/text");
  return value;
}
export interface BlazeCapture {
  provider: "blaze";
  capturedAt: string;
  status: number;
  source: Source;
  data: {
    projection?: Esport;
    manifest: unknown;
    shards: Array<{ version: number; data: unknown }>;
    descriptions: unknown;
  };
}
export interface BlazeRound {
  kind: "listing" | "detail";
  esport: Esport;
  eventId?: string;
  capture: BlazeCapture;
}
