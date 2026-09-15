import { Injectable, Inject } from "@nestjs/common";
import { ProviderRegistry } from "../collection/provider-registry.js";
import { compareAllProviders } from "./matching.js";
import { StaleDataError } from "../../shared/errors/domain-errors.js";
import type { NormalizedEvent } from "../../shared/domain/normalized-event.js";
import type { Esport } from "../../shared/types/common.js";
import { CollectionService } from "../collection/collection.service.js";
@Injectable()
export class MatchingService {
  constructor(
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
    @Inject(CollectionService) private readonly collection: CollectionService,
  ) {}
  compare(games: Esport[]) {
    const events: NormalizedEvent[] = [];
    const eligible = this.collection.matchingEligibleProviders(games);
    for (const provider of this.registry.providers) {
      const eligibleGames = games.filter((game) =>
        eligible[game]?.includes(provider.name),
      );
      for (const game of eligibleGames)
        events.push(...provider.readEvents([game]));
    }
    if (!Object.values(eligible).some((providers) => providers.length))
      throw new StaleDataError("No fresh provider listing");
    return compareAllProviders(events, eligible);
  }
}
