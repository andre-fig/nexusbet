import type { Esport } from "../../shared/types/common.js";
import { teamName } from "../../shared/utils/names.js";

// Only semantic, sport-scoped equivalences remain after common edge words are removed.
export const teamAliases: Record<Esport, Readonly<Record<string, string>>> = {
  cs2: {
    "33": "team 33",
    "l g": "leo team",
    navi: "natus vincere",
  },
  lol: {
    "9z globant": "9z",
    "9z team": "9z",
    "movistar koi": "koi",
    "vivo keyd stars": "keyd stars",
  },
  valorant: {
    "fennel f": "fennel gc",
  },
};

export function canonicalTeamName(value: string, esport: Esport): string {
  const normalized = teamName(value, esport);
  const withoutPrefix = normalized.replace(/^team /, "");
  // Punctuation is already normalized, so "e-sports" becomes "e sports".
  const key = withoutPrefix
    .replace(/ (?:esports|esport|e sports|gaming)$/, "")
    .trim();
  return teamAliases[esport][key] ?? key;
}
