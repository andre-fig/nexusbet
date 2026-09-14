import { ServiceError } from "../errors/domain-errors.js";
import type { Esport } from "../types/common.js";
export const esports: Esport[] = ["cs2", "lol", "valorant"];
export function requestedEsports(value?: string): Esport[] {
  if (value && !esports.includes(value as Esport))
    throw new ServiceError("Invalid esport", 400);
  return value ? [value as Esport] : [...esports];
}
export function isFresh(at: string | undefined, ttl: number, now = Date.now()) {
  return (
    !!at &&
    Number.isFinite(Date.parse(at)) &&
    now - Date.parse(at) <= ttl &&
    Date.parse(at) <= now + 60000
  );
}
