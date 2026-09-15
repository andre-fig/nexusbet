import { Controller, Get, Query, Inject } from "@nestjs/common";
import { MatchingService } from "./matching.service.js";
import { requestedEsports } from "../../shared/utils/freshness.js";
import { displayOdds } from "../../shared/utils/odds-display.js";
@Controller()
export class MatchingController {
  constructor(
    @Inject(MatchingService) private readonly matching: MatchingService,
  ) {}
  @Get("comparisons") async compare(@Query("esport") game?: string) {
    const result = await this.matching.compare(requestedEsports(game));
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
  @Get("matching/unmatched") async unmatched(@Query("esport") game?: string) {
    return (await this.matching.compare(requestedEsports(game))).unmatched;
  }
}
