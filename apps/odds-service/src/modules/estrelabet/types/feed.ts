import type { Source, Esport } from "../../../shared/types/common.js";
export const API_BASE =
  "https://sb2frontend-altenar2.biahosted.com/api/widget/";
export const COMMON_QUERY =
  "culture=pt-BR&timezoneOffset=180&integration=estrelabet&deviceType=1&numFormat=en-GB";
export const CATEGORIES: Record<Esport, number> = {
  cs2: 1534,
  lol: 1531,
  valorant: 1532,
};
export type FeedObject = Record<string, unknown>;
export function object(v: unknown): FeedObject {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Expected EstrelaBet feed object");
  return v as FeedObject;
}
export function rows(v: unknown): FeedObject[] {
  if (!Array.isArray(v)) throw Error("Expected EstrelaBet feed array");
  return v.map(object);
}
export function id(v: unknown): string {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0)
    return String(v);
  throw Error("Invalid EstrelaBet ID");
}
export function text(v: unknown): string {
  if (typeof v !== "string" || !v.trim())
    throw Error("Missing EstrelaBet text");
  return v;
}
export interface EstrelaBetCapture {
  provider: "estrelabet";
  capturedAt: string;
  status: number;
  source: Source;
  data: { pages?: unknown[]; detail?: unknown };
}
export interface EstrelaBetRound {
  kind: "listing" | "detail";
  esport: Esport;
  eventId?: string;
  capture: EstrelaBetCapture;
}
