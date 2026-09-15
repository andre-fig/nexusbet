import {
  Injectable,
  Inject,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { CollectionService } from "./collection.service.js";
import { AppConfiguration } from "../../config/configuration.js";
@Injectable()
export class SchedulerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private tickTimer?: ReturnType<typeof setInterval>;
  constructor(
    @Inject(CollectionService) private readonly collection: CollectionService,
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
  ) {}
  async onApplicationBootstrap() {
    await this.collection.refresh();
    await this.collection.restoreCatalog();
    const c = this.config.settings;
    if (c.runtime !== "server" && c.collection.enabled) {
      this.collection.scheduler.start();
      this.collection.scheduler.tick();
      this.tickTimer = setInterval(
        () => this.collection.scheduler.tick(),
        c.collection.tickMs,
      );
    }
  }
  async onModuleDestroy() {
    clearInterval(this.tickTimer);
    await this.collection.scheduler.stop();
    await this.collection.close();
  }
}
