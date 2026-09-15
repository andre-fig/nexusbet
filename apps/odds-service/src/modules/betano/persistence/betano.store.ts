import type {
  PersistencePort,
  PersistencePublication,
} from "../../../shared/interfaces/persistence-port.interface.js";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { MarketJournal } from "../../snapshots/market-journal.js";
import {
  parseDetail,
  regions,
  type BetanoCapture,
} from "../parsers/feed.parser.js";
import { normalizeListingRound, type ListingRound } from "./listing-round.js";
export { normalizeListingRound } from "./listing-round.js";
export type { ListingRound } from "./listing-round.js";
import type { Esport } from "../../../shared/types/common.js";
import type { NormalizedEvent } from "../../../shared/domain/normalized-event.js";
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
  private async commit(
    publication: PersistencePublication,
    afterCommit: () => Promise<void>,
  ) {
    if (this.persistence)
      await this.persistence.commit(publication, afterCommit);
    else await afterCommit();
  }
  private async writeFileState() {
    if (this.persistence?.enabled) return;
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
      await this.commit(
        {
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
            payload: {
              listings: [...nextListings],
              details: [...this.details],
            },
          },
        },
        async () => {
          // Round-level additions/removals; each market retains its original response timestamp.
          await this.journal.ingest({
            scope,
            complete: true,
            fetchedAt: at,
            source,
            matches: matches.map((e) => ({ ...e, fetchedAt: at })),
          });
          this.listings.set(round.esport, {
            at,
            matches,
            coverage: [...expected],
          });
          await this.writeFileState();
        },
      );
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
      await this.commit(
        {
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
            payload: {
              listings: [...this.listings],
              details: [...nextDetails],
            },
          },
        },
        async () => {
          await this.journal.ingest({
            scope,
            complete: true,
            fetchedAt: at,
            source,
            matches,
          });
          this.details.set(event.eventId, event);
          await this.writeFileState();
        },
      );
    } else throw Error("Unknown round kind");
  }
}
