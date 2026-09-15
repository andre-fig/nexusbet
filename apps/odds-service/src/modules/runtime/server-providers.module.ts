import { presentEvent } from "../../shared/utils/odds-display.js";
import { requestedEsports } from "../../shared/utils/freshness.js";
import { ServerCollectionState } from "./server-collection-state.js";
import { ReceivedCatalog } from "./received-catalog.js";
import {
  Module,
  Injectable,
  Inject,
  OnModuleInit,
  Controller,
  Get,
  Param,
  Query,
} from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module.js";
import { AppConfiguration } from "../../config/configuration.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { PersistenceService } from "../persistence/persistence.service.js";
import { CollectionService } from "../collection/collection.service.js";
import { IngestionCommitService } from "../collection/ingestion-commit.service.js";
import {
  ProviderRegistry,
  ODDS_PROVIDERS,
} from "../collection/provider-registry.js";
import type { ProviderRuntime } from "../../shared/interfaces/odds-provider.interface.js";
import type {
  NormalizedEvent,
  Provider,
} from "../../shared/domain/normalized-event.js";
import type { Esport } from "../../shared/types/common.js";
import {
  ServiceError,
  StaleDataError,
} from "../../shared/errors/domain-errors.js";
import { providers } from "./runtime-settings.js";
import {
  IngestionController,
  IngestionGuard,
  AgentHeartbeats,
} from "./server-ingestion.js";
class ReceivedProvider implements ProviderRuntime {
  readonly pollCadence = "round" as const;
  events: NormalizedEvent[] = [];
  details = new Map<string, NormalizedEvent>();
  constructor(
    readonly name: Provider,
    private readonly ttl: number,
  ) {}
  readEvents(esports: Esport[]) {
    const events = this.events.filter(
      (e) =>
        esports.includes(e.esport) &&
        Date.now() - Date.parse(e.fetchedAt) <= this.ttl,
    );
    if (!events.length) throw new StaleDataError("No fresh provider listing");
    return events;
  }
  readDetail(id: string, esports: Esport[]) {
    const e = this.details.get(id) ?? this.events.find((e) => e.eventId === id);
    if (
      e &&
      (!esports.includes(e.esport) ||
        Date.now() - Date.parse(e.fetchedAt) > this.ttl)
    )
      throw new StaleDataError("Stale provider detail");
    if (!e) throw new ServiceError("Event not found", 404);
    return e;
  }
  async collectEvents(): Promise<NormalizedEvent[]> {
    throw Error("Server cannot collect");
  }
  async collectEventDetails(): Promise<NormalizedEvent> {
    throw Error("Server cannot collect");
  }
  async refresh() {}
  async closeCollection() {}
  selectDetail() {
    return undefined;
  }
  health() {
    const latest = Math.max(
      0,
      ...this.events.map((e) => Date.parse(e.fetchedAt)),
    );
    return {
      status: !latest
        ? "unavailable"
        : Date.now() - latest > this.ttl
          ? "stale"
          : "ok",
      lastUpdatedAt: latest ? new Date(latest).toISOString() : null,
      provider: this.name,
      transport: "ingestion",
      events: this.events.length,
    };
  }
}
@Controller("providers/:provider")
class ReceivedController {
  constructor(
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
  ) {}
  @Get(["events", "matches"]) events(
    @Param("provider") p: string,
    @Query("esport") game?: Esport,
  ) {
    return this.registry
      .get(p)
      .readEvents(requestedEsports(game))
      .map(presentEvent);
  }
  @Get(["events/:id", "matches/:id"]) detail(
    @Param("provider") p: string,
    @Param("id") id: string,
  ) {
    return presentEvent(
      this.registry.get(p).readDetail(id, this.config.settings.esports),
    );
  }
  @Get("health") health(@Param("provider") p: string) {
    return this.registry.get(p).health();
  }
}
@Controller()
class ReceivedCompatibilityController {
  constructor(
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
  ) {}
  @Get("matches") events(@Query("esport") game?: string) {
    return this.registry
      .get("bet365")
      .readEvents(requestedEsports(game))
      .map(presentEvent);
  }
  @Get("matches/:id") detail(@Param("id") id: string) {
    return presentEvent(
      this.registry.get("bet365").readDetail(id, requestedEsports()),
    );
  }
  @Get("provenance") provenance() {
    return { transport: "ingestion", rawMetadataIncluded: false };
  }
}
@Module({
  imports: [AppConfigModule, PersistenceModule],
  providers: [
    {
      provide: ODDS_PROVIDERS,
      inject: [AppConfiguration],
      useFactory: (c: AppConfiguration) =>
        providers.map((p) => new ReceivedProvider(p, c.settings.ttlMs)),
    },
    ProviderRegistry,
    ServerCollectionState,
    { provide: CollectionService, useExisting: ServerCollectionState },
    ReceivedCatalog,
    IngestionGuard,
    AgentHeartbeats,
  ],
  controllers: [
    ReceivedController,
    ReceivedCompatibilityController,
    IngestionController,
  ],
  exports: [ProviderRegistry, CollectionService, ReceivedCatalog],
})
export class CollectionModule {}
