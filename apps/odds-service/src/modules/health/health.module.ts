import { Module } from "@nestjs/common";
import { CollectionModule } from "../runtime/server-providers.module.js";
import { PersistenceModule } from "../persistence/persistence.module.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
@Module({
  imports: [CollectionModule, PersistenceModule],
  providers: [HealthService],
  controllers: [HealthController],
})
export class HealthModule {}
