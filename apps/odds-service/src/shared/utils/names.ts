import type { Esport } from "../types/common.js";
export function cleanName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function teamName(value: string, _esport: Esport): string {
  return cleanName(value);
}
// Competition equivalences are reviewed entries, not automatic stripping of season/phase.
export const tournamentAliases: Record<string, Record<string, string>> = {
  cs2: {
    "cct challengers sa": "cct south america challenger",
    "pulse beat ii": "stake pulse beat",
    "stake ranked": "starladder ranked",
    "cs2 starladder starseries fall": "starladder starseries",
    "cs2 european pro league": "european pro league",
    starseries: "starladder starseries",
  },
  lol: {
    "lol lec summer playoffs": "lec",
    "lol cblol split 2 playoffs": "cblol",
  },
  valorant: {
    "valorant vct champions": "champions",
    "vct champions": "champions",
  },
};
export type PersistedTournamentAliases = Readonly<
  Partial<Record<Esport, Readonly<Record<string, string>>>>
>;
export function tournamentAliasKey(value: string, esport: Esport): string {
  const sportPrefix =
    esport === "cs2" ? "CS2" : esport === "lol" ? "LoL" : "Valorant";
  const prefix = new RegExp(`^\\s*${sportPrefix}\\s*[-:|/]\\s*`, "i");
  return cleanName(value.replace(prefix, ""));
}
export function tournamentName(
  value: string,
  esport: Esport,
  persisted: PersistedTournamentAliases = {},
): string {
  const n = cleanName(value);
  const key = tournamentAliasKey(value, esport);
  return (
    persisted[esport]?.[key] ??
    tournamentAliases[esport]?.[n] ??
    tournamentAliases[esport]?.[key] ??
    key
  );
}
export function names(teamA: string, teamB: string, esport: Esport) {
  return {
    rawTeamA: teamA,
    rawTeamB: teamB,
    normalizedTeamA: teamName(teamA, esport),
    normalizedTeamB: teamName(teamB, esport),
  };
}
