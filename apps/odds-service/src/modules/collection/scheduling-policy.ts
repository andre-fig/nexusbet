import type { DetailIntervals } from "../../config/collection.configuration.js";
import { DEFAULT_DETAIL_INTERVALS } from "../../config/collection.configuration.js";
/** Exact 24h and 6h belong to the longer boundary band; exact 1h is 1–6h. */
export function getDetailInterval(
  startsAt: string,
  now: number | Date,
  intervals: DetailIntervals = DEFAULT_DETAIL_INTERVALS,
): number | null {
  const remaining = Date.parse(startsAt) - Number(now);
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  if (remaining > 24 * 3600000) return intervals.gt24h;
  if (remaining >= 6 * 3600000) return intervals.h6to24;
  if (remaining >= 3600000) return intervals.h1to6;
  return intervals.lt1h;
}
export function backoff(failures: number, steps: number[]): number {
  return steps[Math.min(Math.max(failures - 1, 0), steps.length - 1)];
}
export class CollectionTimeoutError extends Error {
  constructor() {
    super("Operation timed out");
    this.name = "CollectionTimeoutError";
  }
}
export class EventStartedError extends Error {
  constructor() {
    super("Pre-game window ended");
    this.name = "EventStartedError";
  }
}
