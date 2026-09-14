import { readFile, mkdir, writeFile, rename, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseCapture, records } from "../parsers/list.parser.js";
import { parseDetail, type DetailResult } from "../parsers/coupon.parser.js";
import { MarketJournal } from "../../snapshots/market-journal.js";
import type { Capture } from "../types/model.js";
import type {
  DetailedMatch,
  Market,
} from "../../../shared/domain/market-model.js";
export interface DetailRound {
  eventId: string;
  listing: Capture;
  captures: Capture[];
  coverage: "main" | "all_tabs";
}
export function eventRoute(listing: Capture, eventId: string): string {
  const row = records(listing.body).find(
    (r) =>
      r.type === "PA" &&
      r.fields.ID?.startsWith("PC") &&
      r.fields.FI === eventId,
  )?.fields;
  if (!row?.PD) throw Error("Event absent from current listing");
  return row.PD.split("#P^")[0].replace(/#?$/, "#");
}
export const isReadOnlyTab = (tab: { pd: string; name: string }) =>
  !/#I99#/.test(tab.pd) && !/^criar aposta$/i.test(tab.name);
export function normalizeRound(round: DetailRound): {
  match: DetailedMatch;
  parts: DetailResult[];
  coverage: DetailRound["coverage"];
  routes: string[];
} {
  if (
    !["main", "all_tabs"].includes(round.coverage) ||
    !Array.isArray(round.captures) ||
    !round.captures.length
  )
    throw Error("Invalid detail round");
  const listing = parseCapture(round.listing),
    event = listing.matches.find((m) => m.eventId === round.eventId);
  if (!event) throw Error("Event not found in listing");
  const base = eventRoute(round.listing, event.eventId),
    routes = round.captures.map(
      (c) => new URL(c.source.url).searchParams.get("pd") || "",
    );
  if (routes[0] !== base || new Set(routes).size !== routes.length)
    throw Error("Detail main route missing or duplicated");
  const parts = round.captures.map((c) => {
    if (
      Date.parse(c.capturedAt) < Date.parse(round.listing.capturedAt) ||
      Date.parse(c.capturedAt) - Date.parse(round.listing.capturedAt) > 600000
    )
      throw Error("Detail context is stale or from the future");
    return parseDetail(c, {
      match: event,
      inPlay: listing.provenance[event.eventId].inPlay,
    });
  });
  const expected = parts[0].tabs.filter(isReadOnlyTab).map((t) => t.pd);
  if (!expected.includes(base)) throw Error("Main tab not advertised");
  if (routes.some((r) => !expected.includes(r)))
    throw Error("Unadvertised detail route");
  if (
    round.coverage === "all_tabs" &&
    (expected.length !== routes.length ||
      expected.some((r) => !routes.includes(r)))
  )
    throw Error("Incomplete detail tab coverage");
  if (round.coverage === "main" && routes.length !== 1)
    throw Error("Main-only round contains extra tabs");
  const markets = new Map<string, Market>();
  for (const p of [...parts].sort((a, b) =>
    a.match.fetchedAt.localeCompare(b.match.fetchedAt),
  ))
    for (const m of p.match.markets) markets.set(m.marketId, m);
  const latest = [...parts]
    .sort((a, b) => a.match.fetchedAt.localeCompare(b.match.fetchedAt))
    .at(-1)!;
  return {
    match: { ...latest.match, markets: [...markets.values()] },
    parts,
    coverage: round.coverage,
    routes,
  };
}
export class DetailStore {
  readonly latest = new Map<string, ReturnType<typeof normalizeRound>>();
  readonly journal: MarketJournal;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly directory: string,
    journal?: MarketJournal,
  ) {
    this.journal = journal ?? new MarketJournal(directory);
  }
  async load() {
    await mkdir(this.directory, { recursive: true });
    await this.journal.load();
    for (const file of (await readdir(this.directory)).filter((f) =>
      /^\d+\.json$/.test(f),
    )) {
      const result = JSON.parse(
        await readFile(join(this.directory, file), "utf8"),
      );
      this.latest.set(result.match.eventId, result);
    }
  }
  ingest(round: DetailRound): Promise<boolean> {
    const task = this.queue.then(() => this.append(round));
    this.queue = task.catch(() => {});
    return task;
  }
  private async append(round: DetailRound) {
    const result = normalizeRound(round),
      prior = this.latest.get(round.eventId);
    if (prior && prior.match.fetchedAt >= result.match.fetchedAt) return false;
    for (const [i, part] of result.parts.entries())
      await this.journal.ingest({
        scope: `detail:${part.match.esport}:${part.match.eventId}:${result.routes[i]}`,
        complete: true,
        matches: [part.match],
        fetchedAt: part.match.fetchedAt,
        source: round.captures[i].source,
      });
    // Publish only after every advertised tab is present and parsed. Per-market timestamps remain exact.
    const path = join(this.directory, round.eventId + ".json");
    await writeFile(path + ".tmp", JSON.stringify(result), { mode: 0o600 });
    await rename(path + ".tmp", path);
    this.latest.set(round.eventId, result);
    return true;
  }
}
