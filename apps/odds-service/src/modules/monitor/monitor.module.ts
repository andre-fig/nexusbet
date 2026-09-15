import { CollectionModule } from "../collection/collection.module.js";
import { Module } from "@nestjs/common";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { MonitorRepository } from "../persistence/repositories/monitor.repository.js";
import { MonitorService } from "./monitor.service.js";
import { MonitorEventsService } from "./monitor-events.service.js";
import { MonitorController } from "./monitor.controller.js";
import { MemoryDiagnosticsService } from "./memory-diagnostics.service.js";
@Module({
  imports: [PersistenceModule, CollectionModule],
  providers: [
    MonitorRepository,
    MonitorService,
    MonitorEventsService,
    MemoryDiagnosticsService,
  ],
  controllers: [MonitorController],
})
export class MonitorModule {}
