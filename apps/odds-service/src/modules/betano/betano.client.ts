import { Injectable, Inject } from "@nestjs/common";
import { AppConfiguration } from "../../config/configuration.js";
import { nativeDebugEndpoint } from "../../shared/browser/endpoint.js";
import { BetanoBrowser } from "./transport/betano-browser.js";
import { ProviderTransportError } from "../../shared/errors/domain-errors.js";
@Injectable()
export class BetanoClient {
  constructor(
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
  ) {}
  async open() {
    try {
      const c = this.config.settings;
      return await BetanoBrowser.open(
        c.cdpUrl || (await nativeDebugEndpoint(c.chromeDebugPortFile)),
      );
    } catch (e) {
      throw new ProviderTransportError("betano", e);
    }
  }
}
