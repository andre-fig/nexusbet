import { presentEvent } from "../../shared/utils/odds-display.js";
import { Controller, Get, Query, Param, Inject } from "@nestjs/common";
import { EstrelaBetService } from "./estrelabet.service.js";
import { requestedEsports } from "../../shared/utils/freshness.js";
@Controller("providers/estrelabet")
export class EstrelaBetController {
  constructor(
    @Inject(EstrelaBetService) private readonly service: EstrelaBetService,
  ) {}
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
