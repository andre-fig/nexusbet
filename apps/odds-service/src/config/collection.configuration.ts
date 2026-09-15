export interface DetailIntervals {
  gt24h: number;
  h6to24: number;
  h1to6: number;
  lt1h: number;
}
export const DEFAULT_DETAIL_INTERVALS: DetailIntervals = {
  gt24h: 3600000,
  h6to24: 1800000,
  h1to6: 300000,
  lt1h: 60000,
};
export interface CollectionSettings {
  enabled: boolean;
  startupDelayMs: number;
  tickMs: number;
  listIntervalMs: number;
  detail: DetailIntervals;
  jitterMs: number;
  concurrency: {
    bet365: number;
    betano: number;
    superbet: number;
    blaze: number;
    estrelabet: number;
  };
  listTimeoutMs: number;
  detailTimeoutMs: number;
  failureThreshold: number;
  cooldownMs: number;
  backoffMs: number[];
  shutdownGraceMs: number;
}
export function collectionConfiguration(): CollectionSettings {
  const n = (key: string, fallback: number, min = 1) => {
    const v = Number(process.env[key] ?? fallback);
    if (!Number.isSafeInteger(v) || v < min) throw Error("Invalid " + key);
    return v;
  };
  const flag =
    process.env.COLLECTION_ENABLED ?? process.env.POLLING_ENABLED ?? "true";
  if (!["true", "false", "1", "0"].includes(flag))
    throw Error("Invalid COLLECTION_ENABLED");
  return {
    enabled: flag === "true" || flag === "1",
    startupDelayMs: n("COLLECTION_STARTUP_DELAY_MS", 3000, 0),
    tickMs: n("COLLECTION_TICK_MS", 5000, 100),
    listIntervalMs: n("COLLECTION_LIST_INTERVAL_MS", 300000, 30000),
    detail: {
      gt24h: n(
        "DETAIL_INTERVAL_GT_24H_MS",
        DEFAULT_DETAIL_INTERVALS.gt24h,
        30000,
      ),
      h6to24: n(
        "DETAIL_INTERVAL_6H_24H_MS",
        DEFAULT_DETAIL_INTERVALS.h6to24,
        30000,
      ),
      h1to6: n(
        "DETAIL_INTERVAL_1H_6H_MS",
        DEFAULT_DETAIL_INTERVALS.h1to6,
        30000,
      ),
      lt1h: n("DETAIL_INTERVAL_LT_1H_MS", DEFAULT_DETAIL_INTERVALS.lt1h, 30000),
    },
    jitterMs: n("COLLECTION_JITTER_MS", 10000, 0),
    concurrency: {
      bet365: n("BET365_MAX_CONCURRENCY", 1),
      betano: n("BETANO_MAX_CONCURRENCY", 1),
      superbet: n("SUPERBET_MAX_CONCURRENCY", 1),
      estrelabet: n("ESTRELABET_MAX_CONCURRENCY", 1),
      blaze: n("BLAZE_MAX_CONCURRENCY", 1),
    },
    listTimeoutMs: n("PROVIDER_LIST_TIMEOUT_MS", 60000),
    detailTimeoutMs: n("PROVIDER_DETAIL_TIMEOUT_MS", 60000),
    failureThreshold: n("PROVIDER_FAILURE_THRESHOLD", 5),
    cooldownMs: n("PROVIDER_COOLDOWN_MS", 300000, 30000),
    backoffMs: [
      n("COLLECTION_BACKOFF_FIRST_MS", 30000, 30000),
      n("COLLECTION_BACKOFF_SECOND_MS", 60000, 30000),
      n("COLLECTION_BACKOFF_THIRD_MS", 120000, 30000),
      n("COLLECTION_BACKOFF_MAX_MS", 300000, 30000),
    ],
    shutdownGraceMs: n("SHUTDOWN_GRACE_MS", 30000, 0),
  };
}
