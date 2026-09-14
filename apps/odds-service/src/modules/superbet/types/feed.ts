import type { Source, Esport } from "../../../shared/types/common.js";
export const OFFER_ORIGIN =
  "https://production-superbet-offer-br.freetls.fastly.net";
export const SPORTS: Record<Esport, number> = {
  cs2: 55,
  lol: 39,
  valorant: 153,
};
export interface SuperbetCapture {
  provider: "superbet";
  capturedAt: string;
  status: number;
  source: Source;
  data: unknown;
}
export interface Directory {
  tournaments: Map<string, string>;
  outcomes: Map<string, string>;
}
export interface SuperbetRound {
  kind: "listing" | "detail";
  esport: Esport;
  capture: SuperbetCapture;
  structure: SuperbetCapture;
  eventId?: string;
}
export type ObjectValue = Record<string, unknown>;
export function object(v: unknown): ObjectValue {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Expected feed object");
  return v as ObjectValue;
}
export function array(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw Error("Expected feed array");
  return v;
}
export function id(v: unknown): string {
  if ((typeof v !== "string" && typeof v !== "number") || !String(v).trim())
    throw Error("Missing feed ID/text");
  return String(v);
}
