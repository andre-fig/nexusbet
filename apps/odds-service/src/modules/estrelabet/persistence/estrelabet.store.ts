import type { PersistencePort } from "../../../shared/interfaces/persistence-port.interface.js";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Esport } from "../../../shared/types/common.js";
import type { NormalizedEvent } from "../../../shared/domain/normalized-event.js";
import { MarketJournal } from "../../snapshots/market-journal.js";
import { parseListing, parseDetail } from "../parsers/feed.parser.js";
import type { EstrelaBetRound } from "../types/feed.js";
export class EstrelaBetStore {
  readonly listings = new Map<
    Esport,
    { at: string; matches: NormalizedEvent[] }
  >();
  readonly details = new Map<string, NormalizedEvent>();
  constructor(
    readonly directory: string,
    readonly journal: MarketJournal,
    private readonly persistence?: PersistencePort,
  ) {}
  async load() {
    await this.journal.load();
    try {
      const state = this.persistence?.enabled
        ? await this.persistence.restore<{
            listings: Array<
              [Esport, { at: string; matches: NormalizedEvent[] }]
            >;
            details: Array<[string, NormalizedEvent]>;
          }>("estrelabet:state")
        : JSON.parse(
            await readFile(join(this.directory, "latest.json"), "utf8"),
          );
      if (!state) return;
      for (const [k, v] of state.listings) this.listings.set(k, v);
      for (const [k, v] of state.details) this.details.set(k, v);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  async ingest(round: EstrelaBetRound) {
    if (!["listing", "detail"].includes(round.kind))
      throw Error("Invalid round");
    const matches =
      round.kind === "listing"
        ? parseListing(round.capture, round.esport)
        : [parseDetail(round.capture, round.esport, round.eventId!)];
    if (round.kind === "listing" && !matches.length)
      throw Error("Empty EstrelaBet feed is not authoritative removal");
    const at = round.capture.capturedAt,
      previous =
        round.kind === "listing"
          ? this.listings.get(round.esport)?.at
          : this.details.get(matches[0].eventId)?.fetchedAt;
    if (previous && previous > at) return;
    const scope =
      round.kind === "listing"
        ? `estrelabet:list:${round.esport}:prematch`
        : `estrelabet:detail:${matches[0].eventId}:prematch`;
    const listings = new Map(this.listings),
      details = new Map(this.details);
    if (round.kind === "listing") listings.set(round.esport, { at, matches });
    else details.set(matches[0].eventId, matches[0]);
    await this.persistence?.commit({
      provider: "estrelabet",
      esport: round.esport,
      kind: round.kind === "listing" ? "list" : "detail",
      scope,
      fetchedAt: at,
      events: matches,
      observations: [
        {
          scope,
          complete: true,
          matches,
          fetchedAt: at,
          source: round.capture.source,
        },
      ],
      checkpoint: {
        key: "estrelabet:state",
        payload: { listings: [...listings], details: [...details] },
      },
    });
    await this.journal.ingest({
      scope,
      complete: true,
      matches,
      fetchedAt: at,
      source: round.capture.source,
    });

    await mkdir(this.directory, { recursive: true });
    const file = join(this.directory, "latest.json");
    await writeFile(
      file + ".tmp",
      JSON.stringify({ listings: [...listings], details: [...details] }),
      { mode: 0o600 },
    );
    await rename(file + ".tmp", file);
    this.listings.clear();
    for (const [k, v] of listings) this.listings.set(k, v);
    this.details.clear();
    for (const [k, v] of details) this.details.set(k, v);
  }
}
