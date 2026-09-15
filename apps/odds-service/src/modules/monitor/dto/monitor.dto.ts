import { ServiceError } from "../../../shared/errors/domain-errors.js";
export interface EventQuery {
  search?: string;
  esport?: string;
  status?: string;
  start?: string;
  provider?: string;
  attentionOnly?: string;
  page?: string;
  limit?: string;
}
export function integer(v: string | undefined, fallback: number, max: number) {
  if (v === undefined) return fallback;
  if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > max)
    throw new ServiceError("Invalid pagination", 400);
  return Number(v);
}
export function uuid(v: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v,
    )
  )
    throw new ServiceError("Invalid event ID", 400);
  return v;
}
export function date(v: string | undefined) {
  if (v === undefined) return undefined;
  if (
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    throw new ServiceError("Invalid UTC timestamp", 400);
  return new Date(v);
}
export function strings(q: object) {
  for (const v of Object.values(q))
    if (v !== undefined && (typeof v !== "string" || v.length > 500))
      throw new ServiceError("Invalid query value", 400);
}
export function validate(q: EventQuery) {
  strings(q);
  for (const [v, allowed] of [
    [q.esport, ["cs2", "lol", "valorant"]],
    [q.status, ["matched", "partial", "unmatched", "low_confidence", "manual"]],
    [q.start, ["today", "24h", "7d"]],
    [q.attentionOnly, ["true", "false"]],
  ] as const)
    if (v && !allowed.includes(v as never))
      throw new ServiceError("Invalid monitor filter", 400);
  if (q.search && q.search.length > 200)
    throw new ServiceError("Search too long", 400);
  integer(q.page, 1, 100000);
  integer(q.limit, 50, 100);
  return q;
}
export interface EventGroup {
  id: string;
  canonicalId: string | null;
  esport: string;
  tournament: string;
  teamA: string;
  teamB: string;
  startsAt: Date;
  providerCount: number;
  expectedProviderCount: number;
  confidence: number;
  status: string;
  attention: boolean;
  memberIds: string[];
}
