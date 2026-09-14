import { Controller, Get, Query, Param, Inject } from "@nestjs/common";
import { SuperbetService } from "./superbet.service.js";
import { requestedEsports } from "../../shared/utils/freshness.js";
@Controller("providers/superbet")
export class SuperbetController {
  constructor(
    @Inject(SuperbetService) private readonly service: SuperbetService,
  ) {}
  @Get("health") health(@Query("esport") game?: string) {
    requestedEsports(game);
    return this.service.health();
  }
  @Get(["matches", "events"]) events(@Query("esport") game?: string) {
    return this.service.readEvents(requestedEsports(game));
  }
  @Get(["matches/:id", "events/:id"]) detail(
    @Param("id") id: string,
    @Query("esport") game?: string,
  ) {
    return this.service.readDetail(id, requestedEsports(game));
  }
}
