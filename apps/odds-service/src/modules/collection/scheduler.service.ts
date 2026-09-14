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
  private inboxTimer?: ReturnType<typeof setInterval>;
  private refresh?: Promise<unknown>;
  constructor(
    @Inject(CollectionService) private readonly collection: CollectionService,
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
  ) {}
  async onApplicationBootstrap() {
    await this.collection.refresh();
    const c = this.config.settings;
    if (c.scanEnabled)
      this.inboxTimer = setInterval(() => {
        if (!this.refresh)
          this.refresh = this.collection.refresh().finally(() => {
            this.refresh = undefined;
          });
      }, c.scanIntervalMs);
    if (c.collection.enabled) {
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
    clearInterval(this.inboxTimer);
    await this.collection.scheduler.stop();
    await this.refresh;
    await this.collection.close();
  }
}
