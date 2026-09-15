import { LocalCdpService } from "../../shared/browser/local-cdp.service.js";
import { Injectable, Inject } from "@nestjs/common";
import { AppConfiguration } from "../../config/configuration.js";
import { CdpFeed } from "./transport/cdp-feed.js";
import { ProviderTransportError } from "../../shared/errors/domain-errors.js";
import type { CollectOptions } from "../../shared/interfaces/odds-provider.interface.js";
@Injectable()
export class Bet365Client {
  constructor(
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
    @Inject(LocalCdpService) readonly manager: LocalCdpService,
  ) {}
  run<T>(action: () => Promise<T>, signal?: AbortSignal) {
    return this.manager.runExclusive("bet365", action, signal);
  }
  async open(_options: CollectOptions) {
    try {
      return await this.manager.openFeed(
        "bet365",
        (endpoint, targetId) =>
          CdpFeed.open(endpoint, {
            targetId,
            reuseTarget: true,
            warmup: (action) => this.manager.warmup(action),
          }),
        (feed) => feed.detach(),
      );
    } catch (error) {
      throw new ProviderTransportError("bet365", error);
    }
  }
}
