import type { Esport } from "../../shared/types/common.js";
import { teamName } from "../../shared/utils/names.js";

// Only semantic, sport-scoped equivalences remain after common edge words are removed.
export const teamAliases: Record<Esport, Readonly<Record<string, string>>> = {
  cs2: {
    apogee: "betclic apogee",
    betclic: "betclic apogee",
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

// Matching keys stay normalized; these reviewed labels are written on canonical events.
export const canonicalTeamLabels: Record<
  Esport,
  Readonly<Record<string, string>>
> = {
  cs2: {
    "betclic apogee": "Betclic Apogee Esports",
    astral: "ASTRAL Esports",
  },
  lol: {},
  valorant: {},
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

/** Exactly one insertion, deletion or substitution in one substantive word. */
export function oneEditTeamName(a: string, b: string): boolean {
  const left = a.split(" ");
  const right = b.split(" ");
  if (left.length < 2 || left.length !== right.length) return false;
  const different = left.flatMap((word, index) =>
    word === right[index] ? [] : [[word, right[index]]],
  );
  if (different.length !== 1) return false;
  const [first, second] = different[0];
  if (
    Math.min(first.length, second.length) < 5 ||
    Math.abs(first.length - second.length) > 1
  )
    return false;
  if (first.length === second.length)
    return (
      [...first].filter((letter, index) => letter !== second[index]).length ===
      1
    );
  const shorter = first.length < second.length ? first : second;
  const longer = first.length < second.length ? second : first;
  let skipped = false;
  for (let i = 0, j = 0; i < longer.length; i++) {
    if (longer[i] === shorter[j]) j++;
    else if (!skipped) skipped = true;
    else return false;
  }
  return true;
}

export function teamAliasKey(value: string, esport: Esport): string {
  const femaleMarker = esport === "valorant" && /\s*\(f\)\s*$/i.test(value);
  const normalized = teamName(
    femaleMarker ? value.replace(/\s*\(f\)\s*$/i, "") : value,
    esport,
  ).replace(/\bjuniors$/, "junior");
  const withoutPrefix = normalized.replace(/^team /, "");
  // Punctuation is already normalized, so "e-sports" becomes "e sports".
  const key = withoutPrefix
    .replace(/ (?:team|esports|esport|e sports|gaming)$/, "")
    .trim();
  return key;
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
  const key = teamAliasKey(value, esport);
  return (
    markerAlias ?? persisted[esport]?.[key] ?? teamAliases[esport][key] ?? key
  );
}
