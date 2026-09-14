import type { Provider } from "./normalized-event.js";
import type { Esport } from "../types/common.js";
export interface ProviderEventRef {
  provider: Provider;
  eventId: string;
  esport: Esport;
}
