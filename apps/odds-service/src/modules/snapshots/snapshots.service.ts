import { Injectable, Inject, Optional } from "@nestjs/common";
import { MarketJournal } from "./market-journal.js";
import type { Provider } from "../../shared/domain/normalized-event.js";
import {
  PERSISTENCE,
  type PersistencePort,
} from "../../shared/interfaces/persistence-port.interface.js";
@Injectable()
export class SnapshotsService {
  constructor(
    @Optional() @Inject(PERSISTENCE) readonly persistence?: PersistencePort,
  ) {}
  createJournal(directory: string, provider: Provider) {
    return new MarketJournal(directory, this.persistence, provider);
  }
}
