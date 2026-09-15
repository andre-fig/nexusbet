import type { Esport } from "../../shared/types/common.js";
import { teamName } from "../../shared/utils/names.js";

// Reviewed, sport-scoped equivalences only. Do not strip generic team-name words.
export const teamAliases: Record<Esport, Readonly<Record<string, string>>> = {
  cs2: {
    "33": "team 33",
    "l g": "leo team",
    navi: "natus vincere",
    "nemiga gaming": "nemiga",
    "nrg esports": "nrg",
    "team brute": "brute",
  },
  lol: {
    "movistar koi": "koi",
    "vivo keyd stars": "keyd stars",
  },
  valorant: {
    "fennel f": "fennel gc",
    "t1 esports": "t1",
  },
};

export function canonicalTeamName(value: string, esport: Esport): string {
  const normalized = teamName(value, esport);
  return teamAliases[esport][normalized] ?? normalized;
}
