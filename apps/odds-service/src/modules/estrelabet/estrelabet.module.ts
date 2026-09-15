import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module.js";
import { SnapshotsModule } from "../snapshots/snapshots.module.js";
import { EstrelaBetService } from "./estrelabet.service.js";
import { EstrelaBetController } from "./estrelabet.controller.js";
import { EstrelaBetCollector } from "./estrelabet.collector.js";
import { EstrelaBetClient } from "./estrelabet.client.js";
@Module({
  imports: [AppConfigModule, SnapshotsModule],
  controllers: [EstrelaBetController],
  providers: [EstrelaBetService, EstrelaBetCollector, EstrelaBetClient],
  exports: [EstrelaBetService],
})
export class EstrelaBetModule {}
