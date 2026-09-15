import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module.js";
import { SnapshotsModule } from "../snapshots/snapshots.module.js";
import { BlazeService } from "./blaze.service.js";
import { BlazeController } from "./blaze.controller.js";
import { BlazeCollector } from "./blaze.collector.js";
import { BlazeClient } from "./blaze.client.js";
@Module({
  imports: [AppConfigModule, SnapshotsModule],
  controllers: [BlazeController],
  providers: [BlazeService, BlazeCollector, BlazeClient],
  exports: [BlazeService],
})
export class BlazeModule {}
