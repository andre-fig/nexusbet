import type { PersistencePort } from "../../../shared/interfaces/persistence-port.interface.js";
import { normalizedBet365 } from "../mappers/bet365.mapper.js";
import { listMarkets } from "../mappers/list.mapper.js";
import { snapshots, marketChanges } from "../../snapshots/market-journal.js";
import { createHash } from "node:crypto";
import {
  mkdir,
  appendFile,
  writeFile,
  rename,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { Capture, Match, Parsed, Source } from "../types/model.js";
import { parseCapture, validateCapture } from "../parsers/list.parser.js";
export interface Change {
  at: string;
  esport: string;
  eventId: string;
  type: string;
  before?: unknown;
  after?: unknown;
  source: Source;
}
export function changes(
  previous: Match[],
  current: Match[],
  at: string,
  source: Source,
): Change[] {
  const before = new Map(previous.map((m) => [m.eventId, m]));
  const result: Change[] = [];
  for (const m of current) {
    const old = before.get(m.eventId);
    before.delete(m.eventId);
    const base = { at, esport: m.esport, eventId: m.eventId, source };
    if (!old) {
      result.push({ ...base, type: "appeared", after: m });
      continue;
    }
    if (old.status !== m.status)
      result.push({
        ...base,
        type:
          m.status === "live"
            ? "entered_live"
            : m.status === "suspended"
              ? "market_suspended"
              : m.status === "finished"
                ? "finished"
                : "status_changed",
        before: old.status,
        after: m.status,
      });
    for (const market of m.markets)
      for (const s of market.selections) {
        const prior = old.markets
          .find((x) => x.marketId === market.marketId)
          ?.selections.find((x) => x.selectionId === s.selectionId);
        if (prior && prior.odds !== s.odds)
          result.push({
            ...base,
            type: "odds_changed",
            before: { marketId: market.marketId, ...prior },
            after: { marketId: market.marketId, ...s },
          });
      }
  }
  for (const m of before.values())
    result.push({
      at,
      esport: m.esport,
      eventId: m.eventId,
      type: "disappeared",
      before: m,
      source,
    });
  return result;
}
interface State {
  matches: Match[];
  provenance: Parsed["provenance"];
  latest: Record<string, { at: string; hash: string; source: Source }>;
}
export class Store {
  state: State = { matches: [], provenance: {}, latest: {} };
  constructor(
    readonly directory: string,
    private readonly persistence?: PersistencePort,
  ) {}
  async load() {
    await mkdir(this.directory, { recursive: true });
    if (this.persistence?.enabled) {
      this.state =
        (await this.persistence.restore<State>("bet365:list")) ?? this.state;
      return;
    }
    try {
      this.state = JSON.parse(
        await readFile(join(this.directory, "latest.json"), "utf8"),
      ) as State;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  async ingest(
    input: unknown,
  ): Promise<{ ignored: boolean; changes: number; matches: number }> {
    const capture: Capture = validateCapture(input),
      parsed = parseCapture(capture),
      last = this.state.latest[capture.esport];
    const hash = createHash("sha256").update(capture.body).digest("hex");
    if (last && Date.parse(capture.capturedAt) < Date.parse(last.at))
      return { ignored: true, changes: 0, matches: 0 };
    if (last && capture.capturedAt === last.at) {
      if (last.hash !== hash)
        throw new Error("Conflicting snapshot at same time");
      return { ignored: true, changes: 0, matches: 0 };
    }
    const previous = this.state.matches.filter(
      (m) => m.esport === capture.esport,
    );
    const diff = changes(
      previous,
      parsed.matches,
      capture.capturedAt,
      capture.source,
    );
    const next: State = {
      matches: [
        ...this.state.matches.filter((m) => m.esport !== capture.esport),
        ...parsed.matches,
      ],
      provenance: { ...this.state.provenance, ...parsed.provenance },
      latest: {
        ...this.state.latest,
        [capture.esport]: {
          at: capture.capturedAt,
          hash,
          source: capture.source,
        },
      },
    };
    for (const m of previous)
      if (!parsed.provenance[m.eventId]) delete next.provenance[m.eventId];
    await this.persistence?.commit({
      provider: "bet365",
      esport: capture.esport,
      kind: "list",
      scope: "bet365:list:" + capture.esport,
      fetchedAt: capture.capturedAt,
      events: normalizedBet365(parsed.matches, parsed.provenance),
      observations: [
        {
          scope: "bet365:list:" + capture.esport,
          complete: true,
          matches: listMarkets(parsed),
          fetchedAt: capture.capturedAt,
          source: capture.source,
        },
      ],
      checkpoint: { key: "bet365:list", payload: next },
    });
    // The authoritative journal includes both snapshot and associated changes in one append.
    await appendFile(
      join(this.directory, "snapshots.ndjson"),
      JSON.stringify({
        capture: { ...capture, body: undefined },
        hash,
        matches: parsed.matches,
        provenance: parsed.provenance,
        changes: diff,
        oddsSnapshots: snapshots(listMarkets(parsed)),
        marketChanges: marketChanges(
          listMarkets({ matches: previous, provenance: this.state.provenance }),
          listMarkets(parsed),
          capture.capturedAt,
          true,
        ),
      }) + "\n",
      { mode: 0o600 },
    );
    await writeFile(
      join(this.directory, "latest.json.tmp"),
      JSON.stringify(next, null, 2),
      { mode: 0o600 },
    );
    await rename(
      join(this.directory, "latest.json.tmp"),
      join(this.directory, "latest.json"),
    );
    this.state = next;
    return {
      ignored: false,
      changes: diff.length,
      matches: parsed.matches.length,
    };
  }
}
