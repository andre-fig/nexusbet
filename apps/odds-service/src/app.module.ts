import { MonitorModule } from "./modules/monitor/monitor.module.js";
import { Module } from "@nestjs/common";
import { AppConfigModule } from "./config/config.module.js";
import { CollectionModule } from "./modules/collection/collection.module.js";
import { MatchingModule } from "./modules/matching/matching.module.js";
import { HealthModule } from "./modules/health/health.module.js";
@Module({
  imports: [
    MonitorModule,
    AppConfigModule,
    CollectionModule,
    MatchingModule,
    HealthModule,
  ],
})
export class AppModule {}
