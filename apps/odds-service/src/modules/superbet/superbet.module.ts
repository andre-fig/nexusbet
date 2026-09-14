import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module.js";
import { SnapshotsModule } from "../snapshots/snapshots.module.js";
import { SuperbetService } from "./superbet.service.js";
import { SuperbetController } from "./superbet.controller.js";
import { SuperbetCollector } from "./superbet.collector.js";
import { SuperbetClient } from "./superbet.client.js";
@Module({
  imports: [AppConfigModule, SnapshotsModule],
  controllers: [SuperbetController],
  providers: [SuperbetService, SuperbetCollector, SuperbetClient],
  exports: [SuperbetService],
})
export class SuperbetModule {}
