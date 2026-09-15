import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";
import type { MarketChange } from "../../shared/domain/market-model.js";
export interface PublicationNotice {
  provider: string;
  at: string;
  changes: MarketChange[];
  eventIds?: string[];
}
@Injectable()
export class PersistenceNotifications {
  readonly committed = new Subject<PublicationNotice>();
}
