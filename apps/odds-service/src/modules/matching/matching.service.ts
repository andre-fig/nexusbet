import { Injectable, Inject } from "@nestjs/common";
import { ProviderRegistry } from "../collection/provider-registry.js";
import { compareAllProviders } from "./matching.js";
import {
  StaleDataError,
  ProviderUnavailableError,
} from "../../shared/errors/domain-errors.js";
import type { NormalizedEvent } from "../../shared/domain/normalized-event.js";
import type { Esport } from "../../shared/types/common.js";
@Injectable()
export class MatchingService {
  constructor(
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
  ) {}
  compare(games: Esport[]) {
    const events: NormalizedEvent[] = [];
    let available = 0;
    for (const provider of this.registry.providers) {
      try {
        events.push(...provider.readEvents(games));
        available++;
      } catch (e) {
        if (
          !(e instanceof StaleDataError) &&
          !(e instanceof ProviderUnavailableError)
        )
          throw e;
      }
    }
    if (!available) throw new StaleDataError("No fresh provider listing");
    return compareAllProviders(events);
  }
}
