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
