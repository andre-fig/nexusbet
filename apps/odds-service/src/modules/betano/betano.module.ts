import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module.js";
import { SnapshotsModule } from "../snapshots/snapshots.module.js";
import { BetanoService } from "./betano.service.js";
import { BetanoController } from "./betano.controller.js";
import { BetanoCollector } from "./betano.collector.js";
import { BetanoClient } from "./betano.client.js";
@Module({
  imports: [AppConfigModule, SnapshotsModule],
  controllers: [BetanoController],
  providers: [BetanoService, BetanoCollector, BetanoClient],
  exports: [BetanoService],
})
export class BetanoModule {}
