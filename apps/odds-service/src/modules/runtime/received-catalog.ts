import { Injectable, Inject, type OnModuleInit } from "@nestjs/common";
import { ProviderRegistry } from "../collection/provider-registry.js";
import { PersistenceService } from "../persistence/persistence.service.js";
import type { ProviderRuntime } from "../../shared/interfaces/odds-provider.interface.js";
import type { NormalizedEvent } from "../../shared/domain/normalized-event.js";
@Injectable()
export class ReceivedCatalog implements OnModuleInit {
  constructor(
    @Inject(ProviderRegistry) readonly registry: ProviderRegistry,
    @Inject(PersistenceService) readonly persistence: PersistenceService,
  ) {}
  async onModuleInit() {
    await this.refresh();
  }
  private tail: Promise<void> = Promise.resolve();
  refresh() {
    const next = this.tail.then(() => this.reload());
    this.tail = next.catch(() => {});
    return next;
  }
  private async reload() {
    const [events, details] = await Promise.all([
      this.persistence.catalogEvents(),
      this.persistence.detailEvents(),
    ]);
    for (const provider of this.registry.providers) {
      const state = provider as ProviderRuntime & {
        events: NormalizedEvent[];
        details: Map<string, NormalizedEvent>;
      };
      const batches = await this.persistence.baselines(provider.name);
      const nextDetails = new Map<string, NormalizedEvent>();
      const eventMarkets = new Map<
        string,
        Map<string, NormalizedEvent["markets"][number]>
      >();
      for (const batch of batches)
        for (const match of batch.matches) {
          const markets =
            eventMarkets.get(match.eventId) ??
            new Map<string, NormalizedEvent["markets"][number]>();
          eventMarkets.set(match.eventId, markets);
          for (const market of match.markets) {
            const observed = {
              ...market,
              fetchedAt: market.fetchedAt ?? match.fetchedAt,
            };
            const prior = markets.get(market.marketId);
            if (
              !prior ||
              Date.parse(prior.fetchedAt!) < Date.parse(observed.fetchedAt)
            )
              markets.set(market.marketId, observed);
          }
        }
      for (const event of details.filter((e) => e.provider === provider.name))
        nextDetails.set(event.eventId, {
          ...event,
          markets: [...(eventMarkets.get(event.eventId)?.values() ?? [])],
        });
      state.events = events.filter((e) => e.provider === provider.name);
      state.details = nextDetails;
    }
  }
}
