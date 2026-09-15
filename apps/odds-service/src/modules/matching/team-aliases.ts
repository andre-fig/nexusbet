import type { Esport } from "../../shared/types/common.js";
import { teamName } from "../../shared/utils/names.js";

// Only semantic, sport-scoped equivalences remain after common edge words are removed.
export const teamAliases: Record<Esport, Readonly<Record<string, string>>> = {
  cs2: {
    "l g": "leo",
    navi: "natus vincere",
    "wraith pcific": "pcific",
  },
  lol: {
    "9z globant": "9z",
    "movistar koi": "koi",
    "vivo keyd stars": "keyd stars",
  },
  valorant: {
    "fennel f": "fennel gc",
  },
};

export function canonicalTeamName(value: string, esport: Esport): string {
  const femaleMarker = esport === "valorant" && /\s*\(f\)\s*$/i.test(value);
  // Preserve the reviewed FENNEL (F) -> FENNEL GC equivalence before removing
  // a final circuit marker from otherwise equivalent Valorant team names.
  const markerAlias = femaleMarker
    ? teamAliases[esport][teamName(value, esport)]
    : undefined;
  const normalized = teamName(
    femaleMarker ? value.replace(/\s*\(f\)\s*$/i, "") : value,
    esport,
  );
  const withoutPrefix = normalized.replace(/^team /, "");
  // Punctuation is already normalized, so "e-sports" becomes "e sports".
  const key = withoutPrefix
    .replace(/ (?:team|esports|esport|e sports|gaming)$/, "")
    .trim();
  return markerAlias ?? teamAliases[esport][key] ?? key;
}
