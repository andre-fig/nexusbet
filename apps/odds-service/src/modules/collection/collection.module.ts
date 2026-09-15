import { EstrelaBetModule } from "../estrelabet/estrelabet.module.js";
import { EstrelaBetService } from "../estrelabet/estrelabet.service.js";
import { BlazeModule } from "../blaze/blaze.module.js";
import { BlazeService } from "../blaze/blaze.service.js";
import { BrowserModule } from "../../shared/browser/browser.module.js";
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
  imports: [
    BrowserModule,
    AppConfigModule,
    Bet365Module,
    BetanoModule,
    SuperbetModule,
    BlazeModule,
    EstrelaBetModule,
  ],
  providers: [
    {
      provide: ODDS_PROVIDERS,
      useFactory: (
        a: Bet365Service,
        b: BetanoService,
        c: SuperbetService,
        d: BlazeService,
        e: EstrelaBetService,
      ) => [a, b, c, d, e],
      inject: [
        Bet365Service,
        BetanoService,
        SuperbetService,
        BlazeService,
        EstrelaBetService,
      ],
    },
    ProviderRegistry,
    CollectionService,
    SchedulerService,
  ],
  exports: [ProviderRegistry, CollectionService],
})
export class CollectionModule {}
