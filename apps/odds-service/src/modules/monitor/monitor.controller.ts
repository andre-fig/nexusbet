import { Controller, Get, Inject, Param, Query, Sse } from "@nestjs/common";
import { MonitorService } from "./monitor.service.js";
import { MonitorEventsService } from "./monitor-events.service.js";
import type { EventQuery } from "./dto/monitor.dto.js";
@Controller("monitor")
export class MonitorController {
  constructor(
    @Inject(MonitorService) readonly service: MonitorService,
    @Inject(MonitorEventsService) readonly events: MonitorEventsService,
  ) {}
  @Get("overview") overview() {
    return this.service.overview();
  }
  @Get("providers") providers() {
    return this.service.providers();
  }
  @Get("issues") issues(@Query() q: Parameters<MonitorService["issues"]>[0]) {
    return this.service.issues(q);
  }
  @Get("events") list(@Query() q: EventQuery) {
    return this.service.events(q);
  }
  @Get("events/:id") detail(@Param("id") id: string) {
    return this.service.detail(id);
  }
  @Get("events/:id/raw") raw(@Param("id") id: string) {
    return this.service.raw(id);
  }
  @Get("events/:id/odds-history") history(
    @Param("id") id: string,
    @Query() q: Parameters<MonitorService["history"]>[1],
  ) {
    return this.service.history(id, q);
  }
  @Sse("stream") stream() {
    return this.events.stream();
  }
}
