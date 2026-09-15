import "reflect-metadata";
import "dotenv/config";
import { readdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigService } from "@nestjs/config";
import { AppConfiguration, configuration } from "../../config/configuration.js";
import { DatabaseService } from "../database/database.service.js";
import { PersistenceService } from "./persistence.service.js";
import { CatalogRepository } from "./repositories/catalog.repository.js";
import { MatchingRepository } from "./repositories/matching.repository.js";
import { DataIssuesRepository } from "./repositories/issues.repository.js";
import { Store } from "../bet365/persistence/list.store.js";
import {
  DetailStore,
  type DetailRound,
} from "../bet365/persistence/detail.store.js";
import type { Capture } from "../bet365/types/model.js";
import { BetanoStore } from "../betano/persistence/betano.store.js";
import { SuperbetStore } from "../superbet/persistence/superbet.store.js";
import { BlazeStore } from "../blaze/persistence/blaze.store.js";
import { EstrelaBetStore } from "../estrelabet/persistence/estrelabet.store.js";
import { MarketJournal } from "../snapshots/market-journal.js";

type Payload =
  | Capture
  | DetailRound
  | Parameters<BetanoStore["ingest"]>[0]
  | Parameters<SuperbetStore["ingest"]>[0]
  | Parameters<BlazeStore["ingest"]>[0]
  | Parameters<EstrelaBetStore["ingest"]>[0];
type Kind =
  | "bet365-list"
  | "bet365-detail"
  | "betano"
  | "superbet"
  | "blaze"
  | "estrelabet";
function captureTime(value: unknown): number {
  if (!value || typeof value !== "object") return NaN;
  const v = value as Record<string, unknown>;
  if (typeof v.capturedAt === "string") return Date.parse(v.capturedAt);
  if (v.capture) return captureTime(v.capture);
  if (Array.isArray(v.captures) && v.captures.length)
    return Math.max(...v.captures.map(captureTime));
  return NaN;
}
const args = process.argv.slice(2),
  index = args.indexOf("--root");
if (index < 0 || !args[index + 1])
  throw Error(
    "Usage: npm run db:import-legacy -- --root PATH [--apply] [--resume]",
  );
const root = resolve(args[index + 1]);
const entries: Array<{ kind: Kind; at: number; data: Payload }> = [];
for (const [folder, kind] of [
  ["inbox", "bet365-list"],
  ["detail-inbox", "bet365-detail"],
  ["betano-inbox", "betano"],
  ["superbet-inbox", "superbet"],
  ["blaze-inbox", "blaze"],
  ["estrelabet-inbox", "estrelabet"],
] as const) {
  const path = join(root, folder);
  let files: string[];
  try {
    files = await readdir(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
    throw e;
  }
  for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
    const data: Payload = JSON.parse(await readFile(join(path, file), "utf8"));
    const at = captureTime(data);
    if (!Number.isFinite(at))
      throw Error("Invalid archive timestamp; no import started");
    entries.push({ kind, at, data });
  }
}
entries.sort((a, b) => a.at - b.at);
console.log(
  JSON.stringify({
    mode: args.includes("--apply") ? "apply" : "dry-run",
    captures: entries.length,
    byKind: Object.fromEntries(
      [
        "bet365-list",
        "bet365-detail",
        "betano",
        "superbet",
        "blaze",
        "estrelabet",
      ].map((kind) => [kind, entries.filter((e) => e.kind === kind).length]),
    ),
  }),
);
if (args.includes("--apply")) {
  process.env.PERSISTENCE_MODE = "postgres";
  const database = new DatabaseService(
    new AppConfiguration(new ConfigService(configuration())),
  );
  const work = await mkdtemp(join(tmpdir(), "odds-legacy-import-"));
  try {
    await database.onModuleInit();
    if ((await database.db.publication.count()) && !args.includes("--resume"))
      throw Error(
        "Destination contains publications: use an empty database, or --resume for the same archive. Older observations are not backfilled.",
      );
    const persistence = new PersistenceService(
      database,
      new CatalogRepository(),
      new MatchingRepository(new DataIssuesRepository(database)),
    );
    await persistence.onModuleInit();
    const list = new Store(join(work, "bet365"), persistence);
    const detail = new DetailStore(
      join(work, "details"),
      new MarketJournal(join(work, "details"), persistence),
      persistence,
    );
    const betano = new BetanoStore(
      join(work, "betano"),
      new MarketJournal(join(work, "betano"), persistence),
      persistence,
    );
    const superbet = new SuperbetStore(
      join(work, "superbet"),
      new MarketJournal(join(work, "superbet"), persistence),
      persistence,
    );
    const blaze = new BlazeStore(
      join(work, "blaze"),
      new MarketJournal(join(work, "blaze"), persistence),
      persistence,
    );
    const estrelabet = new EstrelaBetStore(
      join(work, "estrelabet"),
      new MarketJournal(join(work, "estrelabet"), persistence),
      persistence,
    );
    await Promise.all([
      list.load(),
      detail.load(),
      betano.load(),
      superbet.load(),
      blaze.load(),
      estrelabet.load(),
    ]);
    const before = await database.db.publication.count();
    for (const entry of entries) {
      switch (entry.kind) {
        case "bet365-list":
          await list.ingest(entry.data as Capture);
          break;
        case "bet365-detail":
          await detail.ingest(entry.data as DetailRound);
          break;
        case "betano":
          await betano.ingest(
            entry.data as Parameters<BetanoStore["ingest"]>[0],
          );
          break;
        case "superbet":
          await superbet.ingest(
            entry.data as Parameters<SuperbetStore["ingest"]>[0],
          );
          break;
        case "blaze":
          await blaze.ingest(entry.data as Parameters<BlazeStore["ingest"]>[0]);
          break;
        case "estrelabet":
          await estrelabet.ingest(
            entry.data as Parameters<EstrelaBetStore["ingest"]>[0],
          );
          break;
      }
    }
    console.log(
      JSON.stringify({
        newPublications: (await database.db.publication.count()) - before,
        snapshots: await database.db.oddsSnapshot.count(),
      }),
    );
  } finally {
    await database.onApplicationShutdown();
    await rm(work, { recursive: true, force: true });
  }
}
