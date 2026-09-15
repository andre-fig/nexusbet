import type {
  PersistencePort,
  PersistencePublication,
} from "../../../shared/interfaces/persistence-port.interface.js";
import { normalizedBet365 } from "../mappers/bet365.mapper.js";
import { readFile, mkdir, writeFile, rename, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseCapture } from "../parsers/list.parser.js";
import { normalizeRound, type DetailRound } from "./detail-round.js";
export {
  eventRoute,
  isReadOnlyTab,
  normalizeRound,
  type DetailRound,
} from "./detail-round.js";
import { MarketJournal } from "../../snapshots/market-journal.js";
export class DetailStore {
  readonly latest = new Map<string, ReturnType<typeof normalizeRound>>();
  readonly journal: MarketJournal;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly directory: string,
    journal?: MarketJournal,
    private readonly persistence?: PersistencePort,
  ) {
    this.journal = journal ?? new MarketJournal(directory);
  }
  async load() {
    if (this.persistence?.enabled) {
      await this.journal.load();
      for (const [id, result] of (await this.persistence.restore<
        Array<[string, ReturnType<typeof normalizeRound>]>
      >("bet365:details")) ?? [])
        this.latest.set(id, result);
      return;
    }
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
    const listing = parseCapture(round.listing),
      event = normalizedBet365(listing.matches, listing.provenance).find(
        (e) => e.eventId === round.eventId,
      )!;
    const next = new Map(this.latest);
    next.set(round.eventId, result);
    const publication: PersistencePublication = {
      provider: "bet365",
      esport: result.match.esport,
      kind: "detail",
      scope: `bet365:detail:${round.eventId}:${round.coverage}`,
      fetchedAt: result.match.fetchedAt,
      events: [{ ...event, ...result.match }],
      observations: result.parts.map((part, i) => ({
        scope: `detail:${part.match.esport}:${part.match.eventId}:${result.routes[i]}`,
        complete: true,
        matches: [part.match],
        fetchedAt: part.match.fetchedAt,
        source: round.captures[i].source,
      })),
      checkpoint: { key: "bet365:details", payload: [...next] },
    };
    const afterCommit = async () => {
      for (const [i, part] of result.parts.entries())
        await this.journal.ingest({
          scope: `detail:${part.match.esport}:${part.match.eventId}:${result.routes[i]}`,
          complete: true,
          matches: [part.match],
          fetchedAt: part.match.fetchedAt,
          source: round.captures[i].source,
        });
      if (!this.persistence?.enabled) {
        // File mode remains available only for tests/replay compatibility.
        const path = join(this.directory, round.eventId + ".json");
        await writeFile(path + ".tmp", JSON.stringify(result), { mode: 0o600 });
        await rename(path + ".tmp", path);
      }
      // Publish only after every advertised tab is present, parsed and committed.
      this.latest.set(round.eventId, result);
    };
    if (this.persistence)
      await this.persistence.commit(publication, afterCommit);
    else await afterCommit();
    return true;
  }
}
