import { Injectable, Inject } from "@nestjs/common";
import type { ProviderRuntime } from "../../shared/interfaces/odds-provider.interface.js";
import { ServiceError } from "../../shared/errors/domain-errors.js";
export const ODDS_PROVIDERS = Symbol("ODDS_PROVIDERS");
@Injectable()
export class ProviderRegistry {
  constructor(@Inject(ODDS_PROVIDERS) readonly providers: ProviderRuntime[]) {}
  get(name: string) {
    const p = this.providers.find((p) => p.name === name);
    if (!p) throw new ServiceError("Unknown provider", 404);
    return p;
  }
}
