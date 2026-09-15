import { Module } from "@nestjs/common";
import { CollectionModule } from "../runtime/server-providers.module.js";
import { MatchingController } from "./matching.controller.js";
import { MatchingService } from "./matching.service.js";
@Module({
  imports: [CollectionModule],
  providers: [MatchingService],
  controllers: [MatchingController],
  exports: [MatchingService],
})
export class MatchingModule {}
