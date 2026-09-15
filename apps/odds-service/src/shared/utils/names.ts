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
// Explicit, sport-scoped equivalences observed in the provider feeds. No edit-distance matching.
export const teamAliases: Record<string, Record<string, string>> = {
  lol: {
    "movistar koi": "koi",
    "vivo keyd stars": "keyd stars",
  },
  cs2: { navi: "natus vincere" },
  valorant: {},
};
export function teamName(value: string, esport: Esport): string {
  const n = cleanName(value)
    .replace(/\besports\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return teamAliases[esport]?.[n] ?? n;
}
// Competition equivalences are reviewed entries, not automatic stripping of season/phase.
export const tournamentAliases: Record<string, Record<string, string>> = {
  cs2: {
    "cs2 starladder starseries fall": "starladder starseries",
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
export function tournamentName(value: string, esport: Esport): string {
  const n = cleanName(value);
  return tournamentAliases[esport]?.[n] ?? n;
}
export function names(teamA: string, teamB: string, esport: Esport) {
  return {
    rawTeamA: teamA,
    rawTeamB: teamB,
    normalizedTeamA: teamName(teamA, esport),
    normalizedTeamB: teamName(teamB, esport),
  };
}
