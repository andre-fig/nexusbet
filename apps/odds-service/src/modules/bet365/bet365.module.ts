import { BrowserModule } from "../../shared/browser/browser.module.js";
import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module.js";
import { SnapshotsModule } from "../snapshots/snapshots.module.js";
import { Bet365Service } from "./bet365.service.js";
import {
  Bet365Controller,
  Bet365CompatibilityController,
} from "./bet365.controller.js";
import { Bet365Collector } from "./bet365.collector.js";
import { Bet365Client } from "./bet365.client.js";
@Module({
  imports: [AppConfigModule, SnapshotsModule, BrowserModule],
  controllers: [Bet365Controller, Bet365CompatibilityController],
  providers: [Bet365Service, Bet365Collector, Bet365Client],
  exports: [Bet365Service],
})
export class Bet365Module {}
