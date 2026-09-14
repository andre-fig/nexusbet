import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module.js";
import { Bet365Module } from "../bet365/bet365.module.js";
import { Bet365Service } from "../bet365/bet365.service.js";
import { BetanoModule } from "../betano/betano.module.js";
import { BetanoService } from "../betano/betano.service.js";
import { SuperbetModule } from "../superbet/superbet.module.js";
import { SuperbetService } from "../superbet/superbet.service.js";
import { CollectionService } from "./collection.service.js";
import { SchedulerService } from "./scheduler.service.js";
import { ODDS_PROVIDERS, ProviderRegistry } from "./provider-registry.js";
@Module({
  imports: [AppConfigModule, Bet365Module, BetanoModule, SuperbetModule],
  providers: [
    {
      provide: ODDS_PROVIDERS,
      useFactory: (a: Bet365Service, b: BetanoService, c: SuperbetService) => [
        a,
        b,
        c,
      ],
      inject: [Bet365Service, BetanoService, SuperbetService],
    },
    ProviderRegistry,
    CollectionService,
    SchedulerService,
  ],
  exports: [ProviderRegistry, CollectionService],
})
export class CollectionModule {}
