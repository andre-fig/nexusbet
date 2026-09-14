import { Controller, Get, Inject } from "@nestjs/common";
import { HealthService } from "./health.service.js";
@Controller("health")
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}
  @Get() get() {
    return this.health.legacy();
  }
}
