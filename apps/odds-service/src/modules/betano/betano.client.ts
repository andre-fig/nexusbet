import { LocalCdpService } from "../../shared/browser/local-cdp.service.js";
import { Injectable, Inject } from "@nestjs/common";
import { AppConfiguration } from "../../config/configuration.js";
import { BetanoBrowser } from "./transport/betano-browser.js";
import { ProviderTransportError } from "../../shared/errors/domain-errors.js";

@Injectable()
export class BetanoClient {
  constructor(
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
    @Inject(LocalCdpService) readonly manager: LocalCdpService,
  ) {}
  run<T>(action: () => Promise<T>, signal?: AbortSignal) {
    return this.manager.runExclusive("betano", action, signal);
  }
  async open() {
    try {
      return await this.manager.openFeed(
        "betano",
        (endpoint, targetId) =>
          BetanoBrowser.open(endpoint, {
            targetId,

            warmup: (action) => this.manager.warmup(action),
          }),
        (feed) => feed.owner.detach(),
      );
    } catch (error) {
      throw new ProviderTransportError("betano", error);
    }
  }
}
