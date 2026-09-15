import type { NormalizedEvent } from "../domain/normalized-event.js";
import type { MarketBatch } from "../domain/market-model.js";
import type { Provider } from "../domain/normalized-event.js";
export interface PersistencePublication {
  provider: string;
  esport: string;
  kind: "list" | "detail";
  scope: string;
  fetchedAt: string;
  events: NormalizedEvent[];
  observations: MarketBatch[];
  checkpoint: { key: string; payload: unknown };
}
/** Storage boundary: provider adapters have no dependency on Prisma/SQL. */
export interface PersistencePort {
  readonly enabled: boolean;
  catalogEvents?(): Promise<NormalizedEvent[]>;
  equivalentObservation?(a: MarketBatch, b: MarketBatch): boolean;
  baselines(provider: Provider): Promise<MarketBatch[]>;
  commit(
    publication: PersistencePublication,
    afterCommit?: () => Promise<void> | void,
  ): Promise<void>;
  restore<T>(key: string): Promise<T | undefined>;
}
export const PERSISTENCE = Symbol("PERSISTENCE");
