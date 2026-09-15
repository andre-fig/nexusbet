import { LocalCdpService } from "../../shared/browser/local-cdp.service.js";
import { DatabaseService } from "../database/database.service.js";
import { CollectionService } from "../collection/collection.service.js";
import { Injectable, Inject, Optional } from "@nestjs/common";
import { Bet365Service } from "../bet365/bet365.service.js";
@Injectable()
export class HealthService {
  constructor(
    @Inject(Bet365Service) private readonly bet365: Bet365Service,
    @Inject(CollectionService) private readonly collection: CollectionService,
    @Optional()
    @Inject(DatabaseService)
    private readonly database?: DatabaseService,
    @Optional()
    @Inject(LocalCdpService)
    private readonly browser?: LocalCdpService,
  ) {}
  legacy() {
    return {
      ...this.bet365.legacyHealth(),
      ...this.collection.operationalHealth(),
      browser: this.browser?.health(),
      database: {
        mode: this.database?.enabled ? "postgres" : "file",
        status: this.database?.enabled
          ? this.database.operationFailed
            ? "degraded"
            : this.database.connected
              ? "connected"
              : "unavailable"
          : "disabled",
      },
    };
  }
}
