import type { NormalizedEvent, Provider } from "../domain/normalized-event.js";
import type { ProviderEventRef } from "../domain/provider-event-ref.js";
import type { Esport } from "../types/common.js";
export interface CollectOptions {
  signal?: AbortSignal;
  publications?: Array<() => Promise<void>>;
  esports: Esport[];
  existing?: boolean;
  reuseProfile?: boolean;
  mainOnly?: boolean;
  eventId?: string;
}
/** Read-only provider boundary. IDs and capture timestamps remain provider-scoped. */
export interface OddsProvider {
  readonly name: Provider;
  collectEvents(options: CollectOptions): Promise<NormalizedEvent[]>;
  collectEventDetails(
    event: ProviderEventRef,
    options: CollectOptions,
  ): Promise<NormalizedEvent>;
}
/** Store/lifecycle adapter used by the registry; global polling policy stays in Collection. */
export interface ProviderRuntime extends OddsProvider {
  readonly pollCadence: "esport" | "round";
  readEvents(esports: Esport[]): NormalizedEvent[];
  readDetail(id: string, esports: Esport[]): NormalizedEvent;
  refresh(): Promise<void>;
  health(): unknown;
  selectDetail(
    events: NormalizedEvent[],
    options: CollectOptions,
  ): ProviderEventRef | undefined;
  closeCollection(): Promise<void>;
}
