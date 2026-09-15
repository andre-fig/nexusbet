import {
  browserConfiguration,
  type BrowserSettings,
} from "./browser.configuration.js";
import {
  collectionConfiguration,
  type CollectionSettings,
} from "./collection.configuration.js";
import { Injectable, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { resolve } from "node:path";
import type { Esport } from "../shared/types/common.js";
export interface Settings {
  runtime?: "server" | "collector-agent";
  collectProviders?: Record<string, boolean>;
  browser: BrowserSettings;
  providerEnabled: Record<"bet365" | "betano", boolean>;
  cdpReconnectCooldownMs: number;
  persistenceMode: "file" | "postgres";
  databaseUrl?: string;
  monitorOrigin?: string;
  collection: CollectionSettings;
  ingestEnabled: boolean;
  port: number;
  host: string;
  ttlMs: number;
  oddsOutlierThresholdPercent: number;
  scanIntervalMs: number;
  scanEnabled: boolean;
  pollingEnabled: boolean;
  pollingIntervalMs: number;
  ingestionMode: "direct";
  legacyInboxImportEnabled: boolean;
  rawCaptureEnabled: boolean;
  rawCaptureRetentionHours: number;
  rawCaptureDir: string;
  memoryDiagnosticsEnabled: boolean;
  memoryDiagnosticsIntervalMs: number;
  memoryDiagnosticsStartupDelayMs: number;
  memoryDiagnosticsHeapSnapshots: boolean;
  memoryDiagnosticsHeapSnapshotAfterMs: number;
  dataDir: string;
  inboxDir: string;
  detailInboxDir: string;
  betanoInboxDir: string;
  superbetInboxDir: string;
  estrelabetInboxDir: string;
  estrelabetEnabled: boolean;
  blazeInboxDir: string;
  blazeEnabled: boolean;
  captureDir: string;
  betanoCaptureDir: string;
  cdpUrl?: string;
  chromeDebugPortFile?: string;
  headless: boolean;
  browserTests: boolean;
  esports: Esport[];
  eventId?: string;
  betanoEventId?: string;
}
export function configuration() {
  const positive = (name: string, fallback: number, min = 1) => {
    const n = Number(process.env[name] ?? fallback);
    if (!Number.isFinite(n) || n < min) throw Error("Invalid " + name);
    return n;
  };
  const esports = (process.env.ESPORTS || "cs2,lol,valorant").split(
    ",",
  ) as Esport[];
  if (esports.some((g) => !["cs2", "lol", "valorant"].includes(g)))
    throw Error("Invalid ESPORTS");
  const runtime = process.env.ODDS_RUNTIME;
  if (runtime && !["server", "collector-agent"].includes(runtime))
    throw Error("Invalid ODDS_RUNTIME");
  const persistenceMode =
    runtime === "collector-agent"
      ? "file"
      : process.env.PERSISTENCE_MODE ||
        (process.env.DATABASE_URL ? "postgres" : "file");
  if (!["file", "postgres"].includes(persistenceMode))
    throw Error("Invalid PERSISTENCE_MODE");
  if (persistenceMode === "postgres" && !process.env.DATABASE_URL)
    throw Error("DATABASE_URL required for PostgreSQL");
  const ingestionMode = process.env.INGESTION_MODE || "direct";
  if (ingestionMode !== "direct") throw Error("Invalid INGESTION_MODE");
  const headless = process.env.HEADLESS ?? "false";
  if (!["true", "false", "1", "0"].includes(headless))
    throw Error("Invalid HEADLESS");
  const enabled = (key: string) => {
    const value =
      process.env[key] ??
      (process.env.BROWSER_RUNTIME === "local-cdp" &&
      process.env.NODE_ENV !== "production"
        ? "true"
        : "false");
    if (!["true", "false", "1", "0"].includes(value))
      throw Error("Invalid " + key);
    return value === "true" || value === "1";
  };
  const estrelabetFlag =
    (runtime === "collector-agent"
      ? process.env.COLLECT_ESTRELABET
      : process.env.ESTRELABET_ENABLED) ?? "true";
  if (!["true", "false", "1", "0"].includes(estrelabetFlag))
    throw Error("Invalid ESTRELABET_ENABLED");
  const blazeFlag =
    (runtime === "collector-agent"
      ? process.env.COLLECT_BLAZE
      : process.env.BLAZE_ENABLED) ?? "true";
  if (!["true", "false", "1", "0"].includes(blazeFlag))
    throw Error("Invalid BLAZE_ENABLED");
  if (process.env.ODDS_MONITOR_ORIGIN)
    for (const origin of process.env.ODDS_MONITOR_ORIGIN.split(",")) {
      const u = new URL(origin.trim());
      if (
        !["http:", "https:"].includes(u.protocol) ||
        u.origin !== origin.trim()
      )
        throw Error("Invalid ODDS_MONITOR_ORIGIN");
    }
  const settings: Settings = {
    runtime: runtime as Settings["runtime"],
    collectProviders: Object.fromEntries(
      ["bet365", "betano", "superbet", "blaze", "estrelabet"].map((p) => {
        const flag = process.env[`COLLECT_${p.toUpperCase()}`] ?? "true";
        if (!["true", "false", "1", "0"].includes(flag))
          throw Error("Invalid collect flag");
        return [p, flag === "true" || flag === "1"];
      }),
    ),
    browser: browserConfiguration(),
    providerEnabled: {
      bet365:
        runtime === "collector-agent"
          ? process.env.COLLECT_BET365 !== "false"
          : enabled("BET365_ENABLED"),
      betano:
        runtime === "collector-agent"
          ? process.env.COLLECT_BETANO !== "false"
          : enabled("BETANO_ENABLED"),
    },
    cdpReconnectCooldownMs: positive(
      "CDP_RECONNECT_COOLDOWN_MS",
      300000,
      60000,
    ),
    persistenceMode: persistenceMode as "file" | "postgres",
    databaseUrl: process.env.DATABASE_URL,
    monitorOrigin: process.env.ODDS_MONITOR_ORIGIN,
    collection: {
      ...collectionConfiguration(),
      ...(runtime === "server" ? { enabled: false } : {}),
    },
    ingestEnabled: process.env.INBOX_INGEST_ENABLED !== "0",
    port: positive("PORT", 3650, 0),
    host: process.env.HOST || "127.0.0.1",
    ttlMs: positive("MAX_AGE_SECONDS", 600) * 1000,
    oddsOutlierThresholdPercent: positive(
      "ODDS_OUTLIER_THRESHOLD_PERCENT",
      10,
      0.01,
    ),
    scanIntervalMs: positive("INBOX_SCAN_INTERVAL_MS", 5000),
    scanEnabled: process.env.INBOX_SCAN_ENABLED !== "0",
    pollingEnabled: process.env.POLLING_ENABLED === "1",
    pollingIntervalMs: positive("CAPTURE_INTERVAL_SECONDS", 180, 60) * 1000,
    ingestionMode,
    legacyInboxImportEnabled:
      process.env.LEGACY_INBOX_IMPORT_ENABLED === "true" ||
      process.env.LEGACY_INBOX_IMPORT_ENABLED === "1",
    rawCaptureEnabled:
      process.env.RAW_CAPTURE_ENABLED === "true" ||
      process.env.RAW_CAPTURE_ENABLED === "1" ||
      process.env.DEBUG_CAPTURE_RAW === "true" ||
      process.env.DEBUG_CAPTURE_RAW === "1",
    rawCaptureRetentionHours: positive("RAW_CAPTURE_RETENTION_HOURS", 24),
    rawCaptureDir: resolve(process.env.RAW_CAPTURE_DIR || "evidence/raw"),
    memoryDiagnosticsEnabled:
      process.env.MEMORY_DIAGNOSTICS_ENABLED === "true" ||
      process.env.MEMORY_DIAGNOSTICS_ENABLED === "1",
    memoryDiagnosticsIntervalMs: positive(
      "MEMORY_DIAGNOSTICS_INTERVAL_MS",
      300000,
      60000,
    ),
    memoryDiagnosticsStartupDelayMs: positive(
      "MEMORY_DIAGNOSTICS_STARTUP_DELAY_MS",
      30000,
      0,
    ),
    memoryDiagnosticsHeapSnapshots:
      process.env.MEMORY_DIAGNOSTICS_HEAP_SNAPSHOTS === "true" ||
      process.env.MEMORY_DIAGNOSTICS_HEAP_SNAPSHOTS === "1",
    memoryDiagnosticsHeapSnapshotAfterMs: positive(
      "MEMORY_DIAGNOSTICS_HEAP_SNAPSHOT_AFTER_MS",
      1800000,
      300000,
    ),
    dataDir: resolve(process.env.DATA_DIR || "data"),
    inboxDir: resolve(process.env.INBOX_DIR || "inbox"),
    detailInboxDir: resolve(process.env.DETAIL_INBOX_DIR || "detail-inbox"),
    estrelabetInboxDir: resolve(
      process.env.ESTRELABET_INBOX_DIR || "estrelabet-inbox",
    ),
    estrelabetEnabled: estrelabetFlag === "true" || estrelabetFlag === "1",
    blazeInboxDir: resolve(process.env.BLAZE_INBOX_DIR || "blaze-inbox"),
    blazeEnabled: blazeFlag === "true" || blazeFlag === "1",
    superbetInboxDir: resolve(
      process.env.SUPERBET_INBOX_DIR || "superbet-inbox",
    ),
    betanoInboxDir: resolve(process.env.BETANO_INBOX_DIR || "betano-inbox"),
    captureDir: resolve(process.env.CAPTURE_DIR || "captures"),
    betanoCaptureDir: resolve(
      process.env.BETANO_CAPTURE_DIR || "captures/betano",
    ),
    cdpUrl: process.env.CDP_ENDPOINT || process.env.CDP_URL,
    chromeDebugPortFile: process.env.CHROME_DEBUG_PORT_FILE,
    headless: headless === "1" || headless === "true",
    browserTests: process.env.BROWSER_TESTS === "1",
    esports,
    eventId: process.env.EVENT_ID,
    betanoEventId: process.env.BETANO_EVENT_ID,
  };
  return { settings };
}
@Injectable()
export class AppConfiguration {
  readonly settings: Settings;
  constructor(@Inject(ConfigService) config: ConfigService) {
    this.settings = config.getOrThrow<Settings>("settings");
  }
}
