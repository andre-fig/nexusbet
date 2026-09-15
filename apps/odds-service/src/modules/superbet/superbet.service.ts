import { Injectable, Inject } from "@nestjs/common";
import { join } from "node:path";
import { AppConfiguration } from "../../config/configuration.js";
import { SnapshotsService } from "../snapshots/snapshots.service.js";
import { SuperbetStore } from "./persistence/superbet.store.js";
import { SuperbetCollector } from "./superbet.collector.js";
import type {
  ProviderRuntime,
  CollectOptions,
} from "../../shared/interfaces/odds-provider.interface.js";
import type { ProviderEventRef } from "../../shared/domain/provider-event-ref.js";
import type { NormalizedEvent } from "../../shared/domain/normalized-event.js";
import type { SuperbetRound } from "./types/feed.js";
import type { Esport } from "../../shared/types/common.js";
import { isFresh } from "../../shared/utils/freshness.js";
import {
  ServiceError,
  StaleDataError,
  ProviderUnavailableError,
} from "../../shared/errors/domain-errors.js";
@Injectable()
export class SuperbetService implements ProviderRuntime {
  readonly name = "superbet" as const;
  readonly pollCadence = "round" as const;
  readonly store: SuperbetStore;
  lastError: string | null = null;
  private loaded = false;
  private loading?: Promise<void>;
  constructor(
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
    @Inject(SuperbetCollector) private readonly collector: SuperbetCollector,
    @Inject(SnapshotsService) snapshots: SnapshotsService,
  ) {
    const path = join(config.settings.dataDir, "superbet");
    this.store = new SuperbetStore(
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
    await this.store.ingest(payload as SuperbetRound);
    this.lastError = null;
  }
  health() {
    return {
      provider: this.name,
      lastError: this.lastError,
      latest: [...this.store.listings].map(([esport, v]) => ({
        esport,
        at: v.at,
      })),
      authenticated: false,
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
      throw new StaleDataError("Missing or stale Superbet listing");
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
      throw new StaleDataError("Missing or stale Superbet detail");
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
