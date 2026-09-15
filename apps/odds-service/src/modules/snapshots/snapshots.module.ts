import { Module } from "@nestjs/common";
const { PersistenceModule } =
  process.env.ODDS_RUNTIME === "collector-agent"
    ? await import("../runtime/remote-persistence.module.js")
    : await import("../persistence/persistence.module.js");
import { SnapshotsService } from "./snapshots.service.js";
@Module({
  imports: [PersistenceModule],
  providers: [SnapshotsService],
  exports: [SnapshotsService],
})
export class SnapshotsModule {}
