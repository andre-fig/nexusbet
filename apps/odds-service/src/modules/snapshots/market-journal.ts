import type { PersistencePort } from "../../shared/interfaces/persistence-port.interface.js";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type {
  DetailedMatch,
  MarketBatch,
  MarketChange,
  OddsSnapshot,
} from "../../shared/domain/market-model.js";
import {
  approximateBytes,
  retainedDomainCounts,
} from "../../shared/utils/memory-diagnostics.js";
export function snapshots(matches: DetailedMatch[]): OddsSnapshot[] {
  return matches.flatMap((e) =>
    e.markets.flatMap((m) =>
      m.selections.map((s) => ({
        provider: e.provider,
        map: m.map,
        eventId: e.eventId,
        marketId: m.marketId,
        selectionId: s.selectionId,
        odds: s.odds,
        line: s.line ?? m.line,
        suspended:
          s.suspended === true || m.suspended === true || e.suspended === true
            ? true
            : (s.suspended ?? m.suspended ?? e.suspended),
        inPlay: s.inPlay ?? m.inPlay ?? e.inPlay,
        fetchedAt: m.fetchedAt ?? e.fetchedAt,
      })),
    ),
  );
}
export function marketChanges(
  before: DetailedMatch[],
  after: DetailedMatch[],
  fetchedAt: string,
  complete: boolean,
): MarketChange[] {
  const result: MarketChange[] = [],
    oldEvents = new Map(before.map((e) => [e.provider + ":" + e.eventId, e]));
  for (const e of after) {
    const old = oldEvents.get(e.provider + ":" + e.eventId);
    oldEvents.delete(e.provider + ":" + e.eventId);
    const base = { provider: e.provider, eventId: e.eventId, fetchedAt };
    if (!old) result.push({ ...base, type: "EventAdded", after: e });
    const oldMarkets = new Map(old?.markets.map((m) => [m.marketId, m]) ?? []);
    for (const m of e.markets) {
      const prior = oldMarkets.get(m.marketId);
      oldMarkets.delete(m.marketId);
      const mb = { ...base, marketId: m.marketId };
      if (!prior) {
        result.push({ ...mb, type: "MarketAdded", after: m });
        continue;
      }
      if (prior.suspended === false && m.suspended === true)
        result.push({
          ...mb,
          type: "MarketSuspended",
          before: false,
          after: true,
        });
      if (prior.suspended === true && m.suspended === false)
        result.push({
          ...mb,
          type: "MarketReopened",
          before: true,
          after: false,
        });
      for (const s of m.selections) {
        const p = prior.selections.find((p) => p.selectionId === s.selectionId);
        if (
          p &&
          (p.odds !== s.odds || p.line !== s.line || prior.line !== m.line)
        )
          result.push({
            ...mb,
            type: "OddsChanged",
            selectionId: s.selectionId,
            before: { odds: p.odds, line: p.line ?? prior.line },
            after: { odds: s.odds, line: s.line ?? m.line },
          });
      }
    }
    if (complete)
      for (const m of oldMarkets.values())
        result.push({
          ...base,
          marketId: m.marketId,
          type: "MarketRemoved",
          before: m,
        });
  }
  if (complete)
    for (const e of oldEvents.values())
      result.push({
        type: "EventRemoved",
        provider: e.provider,
        eventId: e.eventId,
        fetchedAt,
        before: e,
      });
  return result;
}
interface Entry {
  batch: MarketBatch;
  hash: string;
  snapshots: OddsSnapshot[];
  changes: MarketChange[];
}
// One writer per directory. PostgreSQL restores baselines when enabled; otherwise the file journal is authoritative.
export class MarketJournal {
  private latest = new Map<string, Entry>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly directory: string,
    private readonly persistence?: PersistencePort,
  ) {}
  memoryDiagnostics() {
    const entries = [...this.latest.values()];
    return {
      scopes: this.latest.size,
      snapshots: entries.reduce((n, entry) => n + entry.snapshots.length, 0),
      changes: entries.reduce((n, entry) => n + entry.changes.length, 0),
      retainedEntryBytes: entries.reduce(
        (n, entry) => n + Math.max(0, approximateBytes(entry)),
        0,
      ),
      ...retainedDomainCounts(entries.flatMap((entry) => entry.batch.matches)),
    };
  }
  async load() {
    if (this.persistence?.enabled) {
      for (const batch of await this.persistence.baselines())
        this.latest.set(batch.scope, {
          batch,
          hash: createHash("sha256")
            .update(JSON.stringify(batch))
            .digest("hex"),
          snapshots: snapshots(batch.matches),
          changes: [],
        });
      return;
    }
    await mkdir(this.directory, { recursive: true });
    let text: string;
    try {
      text = await readFile(
        join(this.directory, "market-snapshots.ndjson"),
        "utf8",
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    for (const line of text.split("\n").filter(Boolean)) {
      const entry = JSON.parse(line) as Entry;
      this.latest.set(entry.batch.scope, entry);
    }
  }
  ingest(batch: MarketBatch): Promise<Entry | null> {
    const task = this.queue.then(() => this.append(batch));
    this.queue = task.catch(() => {});
    return task;
  }
  private async append(batch: MarketBatch): Promise<Entry | null> {
    if (
      !batch.scope ||
      !Number.isFinite(Date.parse(batch.fetchedAt)) ||
      new Date(batch.fetchedAt).toISOString() !== batch.fetchedAt
    )
      throw Error("Invalid snapshot scope/time");
    if (!batch.matches.length)
      throw Error("Empty feed is not authoritative removal");
    const eventIds = new Set<string>();
    for (const e of batch.matches) {
      if (
        eventIds.has(e.provider + ":" + e.eventId) ||
        e.fetchedAt !== batch.fetchedAt
      )
        throw Error("Duplicate event or inconsistent timestamp");
      eventIds.add(e.provider + ":" + e.eventId);
      const marketIds = new Set<string>();
      for (const m of e.markets) {
        if (marketIds.has(m.marketId)) throw Error("Duplicate market");
        marketIds.add(m.marketId);
        const ids = new Set<string>();
        for (const s of m.selections) {
          if (
            ids.has(s.selectionId) ||
            (s.odds !== null && (!Number.isFinite(s.odds) || s.odds <= 1))
          )
            throw Error("Invalid/duplicate selection");
          ids.add(s.selectionId);
        }
      }
    }
    const hash = createHash("sha256")
        .update(JSON.stringify(batch))
        .digest("hex"),
      last = this.latest.get(batch.scope);
    if (
      last &&
      new Set([...last.batch.matches, ...batch.matches].map((e) => e.provider))
        .size > 1
    )
      throw Error("Provider scope mismatch");
    if (new Set(batch.matches.map((e) => e.provider)).size > 1)
      throw Error("Mixed provider batch");
    if (last && batch.fetchedAt < last.batch.fetchedAt) return null;
    if (last && batch.fetchedAt === last.batch.fetchedAt) {
      if (
        hash !== last.hash &&
        !(
          this.persistence?.enabled &&
          this.persistence.equivalentObservation?.(last.batch, batch)
        )
      )
        throw Error("Conflicting snapshot at same time");
      return null;
    }
    const entry: Entry = {
      batch,
      hash,
      snapshots: snapshots(batch.matches),
      changes: marketChanges(
        last?.batch.matches ?? [],
        batch.matches,
        batch.fetchedAt,
        batch.complete,
      ),
    };
    // Partial detail tabs never replace the complete-event baseline.
    if (!batch.complete)
      throw Error(
        "Partial capture requires a separate scope; not accepted as a full snapshot",
      );
    if (!this.persistence?.enabled) {
      await mkdir(this.directory, { recursive: true });
      await appendFile(
        join(this.directory, "market-snapshots.ndjson"),
        JSON.stringify(entry) + "\n",
        { mode: 0o600 },
      );
    }
    this.latest.set(batch.scope, entry);
    return entry;
  }
}
