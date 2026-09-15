import { Controller, Get, Query, Inject } from "@nestjs/common";
import { MatchingService } from "./matching.service.js";
import { requestedEsports } from "../../shared/utils/freshness.js";
import { displayOdds } from "../../shared/utils/odds-display.js";
@Controller()
export class MatchingController {
  constructor(
    @Inject(MatchingService) private readonly matching: MatchingService,
  ) {}
  @Get("comparisons") compare(@Query("esport") game?: string) {
    const result = this.matching.compare(requestedEsports(game));
    return {
      ...result,
      matched: result.matched.map((match) => ({
        ...match,
        providers: Object.fromEntries(
          Object.entries(match.providers).map(([provider, item]) => [
            provider,
            {
              ...item,
              odds: item.odds.map((market) => ({
                ...market,
                selections: market.selections.map((selection) => ({
                  ...selection,
                  displayOdds: displayOdds(selection.odds),
                })),
              })),
            },
          ]),
        ),
      })),
    };
  }
  @Get("matching/unmatched") unmatched(@Query("esport") game?: string) {
    return this.matching.compare(requestedEsports(game)).unmatched;
  }
}
