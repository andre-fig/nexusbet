import { Injectable, Inject } from "@nestjs/common";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppConfiguration } from "../../config/configuration.js";
import { SnapshotsService } from "../snapshots/snapshots.service.js";
import { EstrelaBetStore } from "./persistence/estrelabet.store.js";
import { EstrelaBetCollector } from "./estrelabet.collector.js";
import type {
  ProviderRuntime,
  CollectOptions,
} from "../../shared/interfaces/odds-provider.interface.js";
import type { ProviderEventRef } from "../../shared/domain/provider-event-ref.js";
import type { NormalizedEvent } from "../../shared/domain/normalized-event.js";
import type { Esport } from "../../shared/types/common.js";
import { isFresh } from "../../shared/utils/freshness.js";
import {
  ServiceError,
  StaleDataError,
  ProviderUnavailableError,
} from "../../shared/errors/domain-errors.js";
@Injectable()
export class EstrelaBetService implements ProviderRuntime {
  readonly name = "estrelabet" as const;
  readonly pollCadence = "round" as const;
  readonly store: EstrelaBetStore;
  lastError: string | null = null;
  private loaded = false;
  private scanning?: Promise<void>;
  private readonly processed = new Set<string>();
  constructor(
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
    @Inject(EstrelaBetCollector)
    private readonly collector: EstrelaBetCollector,
    @Inject(SnapshotsService) snapshots: SnapshotsService,
  ) {
    const path = join(config.settings.dataDir, "estrelabet");
    this.store = new EstrelaBetStore(
      path,
      snapshots.createJournal(path),
      snapshots.persistence,
    );
  }
  refresh() {
    if (!this.config.settings.ingestEnabled) return Promise.resolve();
    if (this.scanning) return this.scanning;
    const task = this.scan();
    this.scanning = task;
    return task.finally(() => {
      this.scanning = undefined;
    });
  }
  private async scan() {
    try {
      if (!this.loaded) {
        await this.store.load();
        this.loaded = true;
      }
      const directory = this.config.settings.estrelabetInboxDir;
      await mkdir(directory, { recursive: true });
      for (const file of (await readdir(directory))
        .filter((f) => f.endsWith(".json"))
        .sort()) {
        if (this.processed.has(file)) continue;
        try {
          await this.store.ingest(
            JSON.parse(await readFile(join(directory, file), "utf8")),
          );
          this.processed.add(file);
          this.lastError = null;
        } catch (e) {
          this.lastError = `${file}: ${(e as Error).message}`;
        }
      }
    } catch (e) {
      this.lastError = "Inbox scan failed";
      throw new ProviderUnavailableError(this.name, e);
    }
  }
  health() {
    return {
      provider: this.name,
      lastError: this.lastError,
      lastListSuccessAt:
        [...this.store.listings.values()]
          .map((v) => v.at)
          .sort()
          .at(-1) ?? null,
      latest: [...this.store.listings].map(([esport, v]) => ({
        esport,
        at: v.at,
      })),
      authenticated: false,
      enabled: this.config.settings.estrelabetEnabled,
      transport: "http",
      eventCount: [...this.store.listings.values()].reduce(
        (n, v) => n + v.matches.length,
        0,
      ),
      lastDetailSuccessAt:
        [...this.store.details.values()]
          .map((e) => e.fetchedAt)
          .sort()
          .at(-1) ?? null,
    };
  }
  readEvents(games: Esport[]) {
    const fresh = (at: string | undefined) =>
      isFresh(at, this.config.settings.ttlMs);
    if (
      games.some(
        (g) =>
          !fresh(this.store.listings.get(g)?.at) ||
          this.store.listings.get(g)?.matches.some((e) => !fresh(e.fetchedAt)),
      )
    )
      throw new StaleDataError("Missing or stale EstrelaBet listing");
    return [...this.store.listings]
      .filter(([g]) => games.includes(g))
      .flatMap(([, v]) => v.matches);
  }
  readDetail(id: string, games: Esport[]) {
    const listed = this.readEvents(games),
      event = this.store.details.get(id);
    if (!event) throw new ServiceError("No detail captured", 404);
    const ttl = this.config.settings.ttlMs;
    if (
      !listed.some((e) => e.eventId === id) ||
      !isFresh(event.fetchedAt, ttl) ||
      event.markets.some((m) => !isFresh(m.fetchedAt || event.fetchedAt, ttl))
    )
      throw new StaleDataError("Missing or stale EstrelaBet detail");
    return { ...event, coverage: "prematch" };
  }
  async collectEvents(options: CollectOptions) {
    try {
      return await this.collector.collectEvents(options);
    } finally {
      if (!options.publications) await this.refresh();
    }
  }
  async collectEventDetails(ref: ProviderEventRef, options: CollectOptions) {
    if (ref.provider !== this.name)
      throw new ServiceError("Wrong provider reference", 400);
    try {
      return await this.collector.collectEventDetails(ref, options);
    } finally {
      if (!options.publications) await this.refresh();
    }
  }
  selectDetail(events: NormalizedEvent[], options: CollectOptions) {
    const e = events.find(
      (e) =>
        (!options.eventId || e.eventId === options.eventId) &&
        e.status === "scheduled",
    );
    return e
      ? { provider: this.name, eventId: e.eventId, esport: e.esport }
      : undefined;
  }
  closeCollection() {
    return this.collector.close();
  }
}
