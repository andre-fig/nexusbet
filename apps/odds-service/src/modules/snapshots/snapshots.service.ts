import { Injectable } from "@nestjs/common";
import { MarketJournal } from "./market-journal.js";
@Injectable()
export class SnapshotsService {
  createJournal(directory: string) {
    return new MarketJournal(directory);
  }
}
