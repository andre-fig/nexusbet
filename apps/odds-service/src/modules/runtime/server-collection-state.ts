import { Injectable, Inject } from "@nestjs/common";
import { ProviderRegistry } from "../collection/provider-registry.js";
import type { Esport } from "../../shared/types/common.js";
import { StaleDataError } from "../../shared/errors/domain-errors.js";
@Injectable()
export class ServerCollectionState {
  constructor(
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
  ) {}
  providerRuntime(name: string) {
    const active = this.registry.providers.some((p) => p.name === name);
    return {
      active,
      status: active ? "active" : "disabled",
      reason: active ? "active" : "disabled_in_runtime",
    };
  }
  activeProviderNames() {
    return this.registry.providers.map((p) => p.name);
  }
  matchingEligibleProviders(games: Esport[]) {
    const result: Partial<Record<Esport, string[]>> = {};
    for (const p of this.registry.providers)
      for (const game of games) {
        try {
          p.readEvents([game]);
          (result[game] ??= []).push(p.name);
        } catch (e) {
          if (!(e instanceof StaleDataError)) throw e;
        }
      }
    return result;
  }
  operationalHealth() {
    return {
      runtime: "server",
      externalCollectorsRunning: 0,
      scheduler: {
        running: false,
        activeJobs: 0,
        queuedJobs: 0,
        scheduledDetails: 0,
      },
      providers: Object.fromEntries(
        this.registry.providers.map((p) => [
          p.name,
          {
            active: true,
            ...(p.health() as Record<string, unknown>),
            activeJobs: 0,
            reason: "active",
          },
        ]),
      ),
    };
  }
  memoryDiagnostics() {
    return { runtime: "server", externalCollectorsRunning: 0 };
  }
}
