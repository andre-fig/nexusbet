import { Controller, Get, Query, Inject } from "@nestjs/common";
import { MatchingService } from "./matching.service.js";
import { requestedEsports } from "../../shared/utils/freshness.js";
@Controller()
export class MatchingController {
  constructor(
    @Inject(MatchingService) private readonly matching: MatchingService,
  ) {}
  @Get("comparisons") compare(@Query("esport") game?: string) {
    return this.matching.compare(requestedEsports(game));
  }
  @Get("matching/unmatched") unmatched(@Query("esport") game?: string) {
    return this.matching.compare(requestedEsports(game)).unmatched;
  }
}
