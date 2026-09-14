import {
  collectionConfiguration,
  type CollectionSettings,
} from "./collection.configuration.js";
import { Injectable, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { resolve } from "node:path";
import type { Esport } from "../shared/types/common.js";
export interface Settings {
  collection: CollectionSettings;
  ingestEnabled: boolean;
  port: number;
  ttlMs: number;
  scanIntervalMs: number;
  scanEnabled: boolean;
  pollingEnabled: boolean;
  pollingIntervalMs: number;
  dataDir: string;
  inboxDir: string;
  detailInboxDir: string;
  betanoInboxDir: string;
  superbetInboxDir: string;
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
  const settings: Settings = {
    collection: collectionConfiguration(),
    ingestEnabled: process.env.INBOX_INGEST_ENABLED !== "0",
    port: positive("PORT", 3650, 0),
    ttlMs: positive("MAX_AGE_SECONDS", 600) * 1000,
    scanIntervalMs: positive("INBOX_SCAN_INTERVAL_MS", 5000),
    scanEnabled: process.env.INBOX_SCAN_ENABLED !== "0",
    pollingEnabled: process.env.POLLING_ENABLED === "1",
    pollingIntervalMs: positive("CAPTURE_INTERVAL_SECONDS", 180, 60) * 1000,
    dataDir: resolve(process.env.DATA_DIR || "data"),
    inboxDir: resolve(process.env.INBOX_DIR || "inbox"),
    detailInboxDir: resolve(process.env.DETAIL_INBOX_DIR || "detail-inbox"),
    superbetInboxDir: resolve(
      process.env.SUPERBET_INBOX_DIR || "superbet-inbox",
    ),
    betanoInboxDir: resolve(process.env.BETANO_INBOX_DIR || "betano-inbox"),
    captureDir: resolve(process.env.CAPTURE_DIR || "captures"),
    betanoCaptureDir: resolve(
      process.env.BETANO_CAPTURE_DIR || "captures/betano",
    ),
    cdpUrl: process.env.CDP_URL,
    chromeDebugPortFile: process.env.CHROME_DEBUG_PORT_FILE,
    headless: process.env.HEADLESS === "1",
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
