import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module.js";
import { DatabaseService } from "./database.service.js";
@Module({
  imports: [AppConfigModule],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
