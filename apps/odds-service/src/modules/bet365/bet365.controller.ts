import { presentEvent } from "../../shared/utils/odds-display.js";
import { Controller, Get, Query, Param, Inject } from "@nestjs/common";
import { Bet365Service } from "./bet365.service.js";
import { requestedEsports } from "../../shared/utils/freshness.js";
@Controller("providers/bet365")
export class Bet365Controller {
  constructor(@Inject(Bet365Service) private readonly service: Bet365Service) {}
  @Get("health") health(@Query("esport") game?: string) {
    requestedEsports(game);
    return this.service.health();
  }
  @Get(["matches", "events"]) events(@Query("esport") game?: string) {
    return this.service.readEvents(requestedEsports(game)).map(presentEvent);
  }
  @Get(["matches/:id", "events/:id"]) detail(
    @Param("id") id: string,
    @Query("esport") game?: string,
  ) {
    return presentEvent(this.service.readDetail(id, requestedEsports(game)));
  }
}
@Controller()
export class Bet365CompatibilityController {
  constructor(@Inject(Bet365Service) private readonly service: Bet365Service) {}
  @Get("matches") events(@Query("esport") game?: string) {
    return this.service.legacyEvents(requestedEsports(game)).map(presentEvent);
  }
  @Get("matches/:id") detail(@Param("id") id: string) {
    return presentEvent(this.service.legacyDetail(id));
  }
  @Get("provenance") provenance() {
    return this.service.provenance();
  }
}
