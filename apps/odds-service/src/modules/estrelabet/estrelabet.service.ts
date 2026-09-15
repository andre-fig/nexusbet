import { Injectable, Inject } from "@nestjs/common";
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
import type { EstrelaBetRound } from "./types/feed.js";
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
  private loading?: Promise<void>;
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
    if (this.loaded) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = this.store
      .load()
      .then(() => {
        this.loaded = true;
        this.lastError = null;
      })
      .catch((error) => {
        this.lastError = "State restore failed";
        throw new ProviderUnavailableError(this.name, error);
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }
  private async publish(payload: unknown) {
    await this.refresh();
    await this.store.ingest(payload as EstrelaBetRound);
    this.lastError = null;
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
      await this.refresh();
      return await this.collector.collectEvents({
        ...options,
        publish: (payload) => this.publish(payload),
      });
    } catch (error) {
      this.lastError = "Collection failed; state preserved";
      throw error;
    }
  }
  async collectEventDetails(ref: ProviderEventRef, options: CollectOptions) {
    if (ref.provider !== this.name)
      throw new ServiceError("Wrong provider reference", 400);
    try {
      await this.refresh();
      return await this.collector.collectEventDetails(ref, {
        ...options,
        publish: (payload) => this.publish(payload),
      });
    } catch (error) {
      this.lastError = "Collection failed; state preserved";
      throw error;
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
