import { Injectable, Inject } from "@nestjs/common";
import { join } from "node:path";
import { AppConfiguration } from "../../config/configuration.js";
import { SnapshotsService } from "../snapshots/snapshots.service.js";
import { Store } from "./persistence/list.store.js";
import { DetailStore } from "./persistence/detail.store.js";
import { Bet365Collector } from "./bet365.collector.js";
import { normalizedBet365 } from "./mappers/bet365.mapper.js";
import type {
  ProviderRuntime,
  CollectOptions,
} from "../../shared/interfaces/odds-provider.interface.js";
import type { ProviderEventRef } from "../../shared/domain/provider-event-ref.js";
import type { NormalizedEvent } from "../../shared/domain/normalized-event.js";
import type { Esport } from "../../shared/types/common.js";
import type { Capture } from "./types/model.js";
import type { DetailRound } from "./persistence/detail.store.js";
import { isFresh } from "../../shared/utils/freshness.js";
import {
  ServiceError,
  StaleDataError,
  ProviderUnavailableError,
} from "../../shared/errors/domain-errors.js";
@Injectable()
export class Bet365Service implements ProviderRuntime {
  readonly name = "bet365" as const;
  readonly pollCadence = "esport" as const;
  readonly store: Store;
  readonly details: DetailStore;
  lastError: string | null = null;
  private loaded = false;
  private loading?: Promise<void>;
  constructor(
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
    @Inject(Bet365Collector) private readonly collector: Bet365Collector,
    @Inject(SnapshotsService) snapshots: SnapshotsService,
  ) {
    this.store = new Store(config.settings.dataDir, snapshots.persistence);
    const path = join(config.settings.dataDir, "details");
    this.details = new DetailStore(
      path,
      snapshots.createJournal(path),
      snapshots.persistence,
    );
  }
  refresh() {
    if (this.loaded) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = Promise.all([this.store.load(), this.details.load()])
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
    if (Array.isArray((payload as DetailRound).captures))
      await this.details.ingest(payload as DetailRound);
    else await this.store.ingest(payload as Capture);
    this.lastError = null;
  }
  health() {
    return {
      provider: this.name,
      lastError: this.lastError,
      latest: this.store.state.latest,
    };
  }
  legacyHealth() {
    return {
      ...this.health(),
      collector:
        "Chrome CDP response capture; shared persistent context with provider tab",
      now: new Date().toISOString(),
    };
  }
  provenance() {
    return this.store.state.provenance;
  }
  private stale(games: Esport[]) {
    return games.filter(
      (g) =>
        !isFresh(this.store.state.latest[g]?.at, this.config.settings.ttlMs),
    );
  }
  legacyEvents(games: Esport[]) {
    const stale = this.stale(games);
    if (stale.length)
      throw new StaleDataError("Missing or stale source data", {
        esports: stale,
      });
    return this.store.state.matches.filter((e) => games.includes(e.esport));
  }
  legacyDetail(id: string) {
    const result = this.details.latest.get(id);
    if (!result) throw new ServiceError("No detail captured", 404);
    const listed = this.store.state.matches.find((e) => e.eventId === id),
      time = listed ? this.store.state.latest[listed.esport]?.at : undefined;
    const ttl = this.config.settings.ttlMs;
    if (
      !isFresh(time, ttl) ||
      !isFresh(result.match.fetchedAt, ttl) ||
      result.match.markets.some(
        (m) => !isFresh(m.fetchedAt || result.match.fetchedAt, ttl),
      )
    )
      throw new StaleDataError("Missing or stale detail/listing data");
    return { ...result.match, coverage: result.coverage };
  }
  readEvents(games: Esport[]) {
    if (this.stale(games).length)
      throw new StaleDataError("Missing or stale bet365 listing");
    return normalizedBet365(
      this.store.state.matches.filter((e) => games.includes(e.esport)),
      this.store.state.provenance,
    );
  }
  readDetail(id: string, games: Esport[]) {
    const event = this.readEvents(games).find((e) => e.eventId === id),
      detail = this.details.latest.get(id);
    if (!event || !detail) throw new ServiceError("No detail captured", 404);
    const ttl = this.config.settings.ttlMs;
    if (
      !isFresh(detail.match.fetchedAt, ttl) ||
      detail.match.markets.some(
        (m) => !isFresh(m.fetchedAt || detail.match.fetchedAt, ttl),
      )
    )
      throw new StaleDataError("Stale bet365 detail");
    return { ...event, ...detail.match, coverage: detail.coverage };
  }
  async collectEvents(options: CollectOptions) {
    try {
      await this.refresh();
      return await this.collector.collectEvents({
        ...options,
        publish: (payload) => this.publish(payload),
      });
    } catch (error) {
      await this.collector.recordFailure("listing", error);
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
      await this.collector.recordFailure("detail", error);
      this.lastError = "Collection failed; state preserved";
      throw error;
    }
  }
  selectDetail(events: NormalizedEvent[], options: CollectOptions) {
    const id = options.eventId || this.config.settings.eventId;
    const e = events.find((e) =>
      id ? e.eventId === id : e.status === "scheduled",
    );
    return e
      ? { provider: this.name, eventId: e.eventId, esport: e.esport }
      : undefined;
  }
  closeCollection() {
    return this.collector.close();
  }
}
