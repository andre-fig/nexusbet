import { CollectionService } from "../collection/collection.service.js";
import { Injectable, Inject } from "@nestjs/common";
import { Bet365Service } from "../bet365/bet365.service.js";
@Injectable()
export class HealthService {
  constructor(
    @Inject(Bet365Service) private readonly bet365: Bet365Service,
    @Inject(CollectionService) private readonly collection: CollectionService,
  ) {}
  legacy() {
    return {
      ...this.bet365.legacyHealth(),
      ...this.collection.scheduler.health(),
    };
  }
}
