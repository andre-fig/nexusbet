import type { DetailedMatch } from "./market-model.js";
import type { Status } from "../types/common.js";
export type Provider =
  "bet365" | "betano" | "superbet" | "blaze" | "estrelabet";
/** Common feed projection, independent of ORM IDs. Disappearance never implies finished. */
export interface NormalizedEvent extends DetailedMatch {
  tournament: string;
  startsAt: string;
  status: Status;
  rawTeamA: string;
  rawTeamB: string;
  normalizedTeamA: string;
  normalizedTeamB: string;
  provenance: Record<string, unknown>;
}
