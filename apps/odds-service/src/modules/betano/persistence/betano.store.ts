import type { PersistencePort } from "../../../shared/interfaces/persistence-port.interface.js";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { MarketJournal } from "../../snapshots/market-journal.js";
import {
  parseListing,
  parseDetail,
  validate,
  regions,
  type BetanoCapture,
} from "../parsers/feed.parser.js";
import type { Esport } from "../../../shared/types/common.js";
import type { NormalizedEvent } from "../../../shared/domain/normalized-event.js";
export interface ListingRound {
  kind: "listing";
  esport: Esport;
  directory: BetanoCapture;
  regionId: string;
  expectedLeagues: string[];
  captures: BetanoCapture[];
}
export interface DetailRound {
  kind: "detail";
  esport: Esport;
  capture: BetanoCapture;
}
export class BetanoStore {
  readonly listings = new Map<
    Esport,
    { at: string; matches: NormalizedEvent[]; coverage: string[] }
  >();
  readonly details = new Map<string, NormalizedEvent>();
  readonly journal: MarketJournal;
  constructor(
    readonly directory: string,
    journal?: MarketJournal,
    private readonly persistence?: PersistencePort,
  ) {
    this.journal = journal ?? new MarketJournal(directory);
  }
  async load() {
    await this.journal.load();
    try {
      const state = this.persistence?.enabled
        ? await this.persistence.restore<{
            listings: Array<
              [
                Esport,
                { at: string; matches: NormalizedEvent[]; coverage: string[] },
              ]
            >;
            details: Array<[string, NormalizedEvent]>;
          }>("betano:state")
        : JSON.parse(
            await readFile(join(this.directory, "latest.json"), "utf8"),
          );
      if (!state) return;
      for (const [k, v] of state.listings) this.listings.set(k, v);
      for (const [k, v] of state.details) this.details.set(k, v);
    } catch (e) {
      if ((e as any).code !== "ENOENT") throw e;
    }
  }
  async ingest(round: ListingRound | DetailRound) {
    if (!regions[round.esport]) throw Error("Invalid esport");
    let at: string,
      source: BetanoCapture["source"],
      scope: string,
      matches: NormalizedEvent[];
    if (round.kind === "listing") {
      const normalized = normalizeListingRound(round);
      ({ at, source, scope, matches } = normalized);
      const expected = normalized.coverage;
      if (this.listings.get(round.esport)?.at! > at) return;
      const nextListings = new Map(this.listings);
      nextListings.set(round.esport, { at, matches, coverage: [...expected] });
      await this.persistence?.commit({
        provider: "betano",
        esport: round.esport,
        kind: "list",
        scope,
        fetchedAt: at,
        events: matches,
        observations: [
          {
            scope,
            complete: true,
            fetchedAt: at,
            source,
            matches: matches.map((e) => ({ ...e, fetchedAt: at })),
          },
        ],
        checkpoint: {
          key: "betano:state",
          payload: { listings: [...nextListings], details: [...this.details] },
        },
      });
      // Round-level additions/removals; each market retains its original response timestamp.
      await this.journal.ingest({
        scope,
        complete: true,
        fetchedAt: at,
        source,
        matches: matches.map((e) => ({ ...e, fetchedAt: at })),
      });
      this.listings.set(round.esport, { at, matches, coverage: [...expected] });
    } else if (round.kind === "detail") {
      const event = parseDetail(
        round.capture,
        round.esport,
        String(round.capture.data.event?.id),
      );
      at = event.fetchedAt;
      if (this.details.get(event.eventId)?.fetchedAt! > at) return;
      const tab = round.capture.data.markets?.find(
        (t: any) => t.selected,
      )?.type;
      if (tab !== "popular") throw Error("Unexpected detail scope");
      scope = "betano:detail:" + event.eventId + ":popular";
      source = round.capture.source;
      matches = [event];
      const nextDetails = new Map(this.details);
      nextDetails.set(event.eventId, event);
      await this.persistence?.commit({
        provider: "betano",
        esport: round.esport,
        kind: "detail",
        scope,
        fetchedAt: at,
        events: matches,
        observations: [
          { scope, complete: true, fetchedAt: at, source, matches },
        ],
        checkpoint: {
          key: "betano:state",
          payload: { listings: [...this.listings], details: [...nextDetails] },
        },
      });
      await this.journal.ingest({
        scope,
        complete: true,
        fetchedAt: at,
        source,
        matches,
      });
      this.details.set(event.eventId, event);
    } else throw Error("Unknown round kind");
    await mkdir(this.directory, { recursive: true });
    const file = join(this.directory, "latest.json");
    await writeFile(
      file + ".tmp",
      JSON.stringify({
        listings: [...this.listings],
        details: [...this.details],
      }),
      { mode: 0o600 },
    );
    await rename(file + ".tmp", file);
  }
}

/** Same coverage validation used before both deferred publication and journal ingestion. */
export function normalizeListingRound(round: ListingRound) {
  let at: string,
    source: BetanoCapture["source"],
    scope: string,
    matches: NormalizedEvent[];
  validate(round.directory);
  const advertised = round.directory.data.regionGroups
    ?.flatMap((g: any) => g.regions)
    .find((r: any) => String(r.id) === regions[round.esport].id);
  if (!advertised || round.regionId !== regions[round.esport].id)
    throw Error("Missing region coverage");
  const expected = new Set<string>(
    advertised.leagues.map((l: any) => String(l.id)),
  );
  if (
    expected.size !== round.expectedLeagues.length ||
    round.expectedLeagues.some((id) => !expected.has(id))
  )
    throw Error("Partial competition coverage");
  const actual = new Set<string>();
  const found = new Map<string, NormalizedEvent>();
  for (const c of round.captures) {
    const items = parseListing(c, round.esport);
    for (const b of c.data.blocks) {
      if (!expected.has(String(b.id))) throw Error("Unexpected competition");
      actual.add(String(b.id));
    }
    const sl = new URL(c.source.url).searchParams.get("sl");
    if (c.data.blocks.length === 0 && sl && expected.has(sl)) actual.add(sl);
    for (const e of items) {
      const prior = found.get(e.eventId);
      if (prior && prior.provenance.leagueId !== e.provenance.leagueId)
        throw Error("Conflicting event competition");
      if (!prior || prior.fetchedAt < e.fetchedAt) found.set(e.eventId, e);
    }
  }
  if ([...expected].some((id) => !actual.has(id)))
    throw Error("Incomplete listing round");
  if (!round.captures.length) throw Error("Empty capture round");
  const times = round.captures.map((c) => c.capturedAt).sort();
  at = times.at(-1)!;
  if (Date.parse(at) - Date.parse(times[0]) > 600000)
    throw Error("Listing round too old");
  source = round.captures.at(-1)!.source;
  scope = "betano:list:" + round.esport;
  matches = [...found.values()];

  return { at, source, scope, matches, coverage: [...expected] };
}
