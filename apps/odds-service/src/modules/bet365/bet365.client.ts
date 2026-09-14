import { openHeadlessFeed } from "../../shared/browser/headless-feed.js";
import { Injectable, Inject } from "@nestjs/common";
import { AppConfiguration } from "../../config/configuration.js";
import { CdpFeed } from "./transport/cdp-feed.js";
import { BrowserFeed } from "./transport/browser-feed.js";
import { nativeDebugEndpoint } from "../../shared/browser/endpoint.js";
import type { CollectOptions } from "../../shared/interfaces/odds-provider.interface.js";
import { ProviderTransportError } from "../../shared/errors/domain-errors.js";
@Injectable()
export class Bet365Client {
  constructor(
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
  ) {}
  async open(options: CollectOptions) {
    try {
      const c = this.config.settings;
      if (c.headless)
        return await openHeadlessFeed((endpoint) =>
          CdpFeed.open(endpoint, { anonymous: true }),
        );
      const endpoint =
        c.cdpUrl ||
        (options.existing
          ? await nativeDebugEndpoint(c.chromeDebugPortFile)
          : undefined);
      return endpoint
        ? await CdpFeed.open(endpoint, { anonymous: !options.reuseProfile })
        : await BrowserFeed.open(undefined, { headless: c.headless });
    } catch (error) {
      throw new ProviderTransportError("bet365", error);
    }
  }
}
