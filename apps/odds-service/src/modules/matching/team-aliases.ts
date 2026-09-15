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
    "mibr los": "los",
    "movistar koi": "koi",
    "vivo keyd stars": "keyd stars",
  },
  valorant: {
    "fennel f": "fennel gc",
  },
};

export type PersistedTeamAliases = Readonly<
  Partial<Record<Esport, Readonly<Record<string, string>>>>
>;

/** Match a compact bookmaker abbreviation against a longer name, retaining its suffix. */
export function abbreviatedTeamName(
  shortName: string,
  longName: string,
): boolean {
  const short = shortName.split(" ");
  const long = longName.split(" ");
  if (short.length < 2 || long.length <= short.length) return false;
  for (let prefixLength = 2; prefixLength < long.length; prefixLength++) {
    const suffix = long.slice(prefixLength);
    if (suffix.join(" ") !== short.slice(1).join(" ")) continue;
    const prefix = long.slice(0, prefixLength);
    const abbreviation =
      prefix[0] +
      prefix
        .slice(1)
        .map((word) => word[0])
        .join("");
    if (short[0].length >= 3 && short[0] === abbreviation) return true;
  }
  return false;
}

/** One plural marker may differ when all other words of a team name agree. */
export function inflectedTeamName(a: string, b: string): boolean {
  const left = a.split(" ");
  const right = b.split(" ");
  if (left.length < 2 || left.length !== right.length) return false;
  const different = left.flatMap((word, index) =>
    word === right[index] ? [] : [[word, right[index]]],
  );
  if (different.length !== 1) return false;
  const [first, second] = different[0];
  const pluralOf = (plural: string, singular: string) =>
    plural.length >= 5 &&
    plural.endsWith("s") &&
    plural.slice(0, -1) === singular;
  return pluralOf(first, second) || pluralOf(second, first);
}

export function canonicalTeamName(
  value: string,
  esport: Esport,
  persisted: PersistedTeamAliases = {},
): string {
  const femaleMarker = esport === "valorant" && /\s*\(f\)\s*$/i.test(value);
  // Preserve the reviewed FENNEL (F) -> FENNEL GC equivalence before removing
  // a final circuit marker from otherwise equivalent Valorant team names.
  const markerAlias = femaleMarker
    ? teamAliases[esport][teamName(value, esport)]
    : undefined;
  const normalized = teamName(
    femaleMarker ? value.replace(/\s*\(f\)\s*$/i, "") : value,
    esport,
  ).replace(/\bjuniors$/, "junior");
  const withoutPrefix = normalized.replace(/^team /, "");
  // Punctuation is already normalized, so "e-sports" becomes "e sports".
  const key = withoutPrefix
    .replace(/ (?:team|esports|esport|e sports|gaming)$/, "")
    .trim();
  return (
    markerAlias ?? persisted[esport]?.[key] ?? teamAliases[esport][key] ?? key
  );
}
