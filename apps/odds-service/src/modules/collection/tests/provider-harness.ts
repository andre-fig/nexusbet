// Legacy in-process fixture harness. Production runtimes use separate DI graphs.
import { Module } from "@nestjs/common";
import { CollectionModule } from "../collection.module.js";
import { Bet365Module } from "../../bet365/bet365.module.js";
import { BrowserModule } from "../../../shared/browser/browser.module.js";
import { HealthService } from "../../health/health.service.js";
import { HealthController } from "../../health/health.controller.js";
import { MatchingService } from "../../matching/matching.service.js";
import { MatchingController } from "../../matching/matching.controller.js";
@Module({
  imports: [CollectionModule, Bet365Module, BrowserModule],
  providers: [HealthService, MatchingService],
  controllers: [HealthController, MatchingController],
})
export class AppModule {}
