import { Injectable, Inject } from "@nestjs/common";
import { ProviderRegistry } from "../collection/provider-registry.js";
import { compareAllProviders } from "./matching.js";
import { StaleDataError } from "../../shared/errors/domain-errors.js";
import type { NormalizedEvent } from "../../shared/domain/normalized-event.js";
import type { Esport } from "../../shared/types/common.js";
import { CollectionService } from "../collection/collection.service.js";
import { DatabaseService } from "../database/database.service.js";
import type { PersistedTeamAliases } from "./team-aliases.js";
@Injectable()
export class MatchingService {
  constructor(
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
    @Inject(CollectionService) private readonly collection: CollectionService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}
  async compare(games: Esport[]) {
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
    const aliases: Record<Esport, Record<string, string>> = {
      cs2: {},
      lol: {},
      valorant: {},
    };
    if (this.database.enabled) {
      const rows = await this.database.read((db) => db.teamAlias.findMany());
      for (const row of rows)
        if (row.esport in aliases)
          aliases[row.esport as Esport][row.alias] = row.canonicalName;
    }
    return compareAllProviders(events, eligible, aliases);
  }
}
