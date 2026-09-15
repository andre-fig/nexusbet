import { BrowserModule } from "../../shared/browser/browser.module.js";
import { CollectionModule } from "../collection/collection.module.js";
import { Module } from "@nestjs/common";
import { Bet365Module } from "../bet365/bet365.module.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
@Module({
  imports: [Bet365Module, CollectionModule, BrowserModule],
  providers: [HealthService],
  controllers: [HealthController],
})
export class HealthModule {}
