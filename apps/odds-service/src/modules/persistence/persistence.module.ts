import { PersistenceNotifications } from "./persistence-notifications.js";
import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { PersistenceService } from "./persistence.service.js";
import { CatalogRepository } from "./repositories/catalog.repository.js";
import { MatchingRepository } from "./repositories/matching.repository.js";
import { DataIssuesRepository } from "./repositories/issues.repository.js";
import { OddsReadRepository } from "./repositories/read.repository.js";
import { PersistenceController } from "./persistence.controller.js";
import { PERSISTENCE } from "../../shared/interfaces/persistence-port.interface.js";
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    PersistenceNotifications,
    PersistenceService,
    CatalogRepository,
    MatchingRepository,
    DataIssuesRepository,
    OddsReadRepository,
    { provide: PERSISTENCE, useExisting: PersistenceService },
  ],
  controllers: [PersistenceController],
  exports: [
    PersistenceNotifications,
    PERSISTENCE,
    PersistenceService,
    DatabaseModule,
  ],
})
export class PersistenceModule {}
