import type { NormalizedEvent } from "../../shared/domain/normalized-event.js";
import {
  tournamentAliasKey,
  tournamentName,
  type PersistedTournamentAliases,
} from "../../shared/utils/names.js";
import {
  abbreviatedTeamName,
  canonicalTeamLabels,
  canonicalTeamName,
  inflectedTeamName,
  oneEditTeamName,
  teamAliasKey,
  teamAliases,
  type PersistedTeamAliases,
} from "./team-aliases.js";
import { incompleteWinnerMarket } from "../../shared/utils/market-quality.js";
/** Compatibility entry point; all matching uses provider-scoped identities. */
export function compareProviders(a: NormalizedEvent[], b: NormalizedEvent[]) {
  return compareAllProviders(
    [...a, ...b],
    [...new Set([...a, ...b].map((event) => event.provider))],
  );
}
export type EligibleProviders = Readonly<
  Partial<Record<NormalizedEvent["esport"], readonly string[]>>
>;
function pair(e: NormalizedEvent, aliases: PersistedTeamAliases) {
  return [
    canonicalTeamName(e.teamA, e.esport, aliases),
    canonicalTeamName(e.teamB, e.esport, aliases),
  ]
    .sort()
    .join("|");
}
function aliasCandidate(
  e: NormalizedEvent,
  f: NormalizedEvent,
  aliases: PersistedTeamAliases,
  tournaments: PersistedTournamentAliases,
) {
  if (
    tournamentName(e.tournament, e.esport, tournaments) !==
    tournamentName(f.tournament, f.esport, tournaments)
  )
    return false;
  const sides = [
    [e.teamA, e.teamB, f.teamA, f.teamB],
    [e.teamA, e.teamB, f.teamB, f.teamA],
  ];
  return sides.some(([a, b, c, d]) => {
    const first = canonicalTeamName(a, e.esport, aliases);
    const third = canonicalTeamName(c, e.esport, aliases);
    const second = canonicalTeamName(b, e.esport, aliases);
    const fourth = canonicalTeamName(d, e.esport, aliases);
    return (
      first === third &&
      second !== fourth &&
      (abbreviatedTeamName(second, fourth) ||
        abbreviatedTeamName(fourth, second) ||
        inflectedTeamName(second, fourth) ||
        oneEditTeamName(second, fourth))
    );
  });
}
function eligible(
  e: NormalizedEvent,
  f: NormalizedEvent,
  aliases: PersistedTeamAliases,
  tournaments: PersistedTournamentAliases,
) {
  const delta = Math.abs(Date.parse(e.startsAt) - Date.parse(f.startsAt));
  const samePair = pair(e, aliases) === pair(f, aliases);
  const prematch = (event: NormalizedEvent) =>
    event.status === "scheduled" ||
    (event.status === "suspended" &&
      event.inPlay !== true &&
      Date.parse(event.startsAt) > Date.parse(event.fetchedAt));
  return (
    e.provider !== f.provider &&
    e.esport === f.esport &&
    prematch(e) &&
    prematch(f) &&
    (samePair
      ? delta === 0 ||
        (delta <= 5 * 60_000 &&
          tournamentName(e.tournament, e.esport, tournaments) ===
            tournamentName(f.tournament, f.esport, tournaments))
      : delta <= 5 * 60_000 && aliasCandidate(e, f, aliases, tournaments))
  );
}
/** A component must be a complete, one-event-per-provider clique. No transitive fuzzy joins. */
export function compareAllProviders(
  events: NormalizedEvent[],
  eligibleProviders: readonly string[] | EligibleProviders = [
    ...new Set(events.map((event) => event.provider)),
  ],
  aliases: PersistedTeamAliases = {},
  tournaments: PersistedTournamentAliases = {},
) {
  const key = (e: NormalizedEvent) => e.provider + ":" + e.eventId;
  const unique = new Map<string, NormalizedEvent>();
  const conflicts = new Set<string>();
  const providersFor = (event: NormalizedEvent) =>
    new Set(
      Array.isArray(eligibleProviders)
        ? eligibleProviders
        : ((eligibleProviders as EligibleProviders)[event.esport] ?? []),
    );
  for (const e of events) {
    if (!providersFor(e).has(e.provider)) continue;
    const prior = unique.get(key(e));
    if (prior && JSON.stringify(prior) !== JSON.stringify(e))
      conflicts.add(key(e));
    unique.set(key(e), e);
  }
  const notApplicable = [...unique.values()]
    .filter((event) => providersFor(event).size < 2)
    .map((event) => ({
      provider: event.provider,
      eventId: event.eventId,
      reason: "only_one_eligible_provider" as const,
    }));
  const all = [...unique.values()].filter(
      (event) => providersFor(event).size >= 2,
    ),
    seen = new Set<string>(),
    matched: ReturnType<typeof comparison>[] = [],
    unmatched: {
      provider: string;
      eventId: string;
      reason: string;
      candidates?: string[];
    }[] = [];
  for (const e of all) {
    if (seen.has(key(e))) continue;
    const group: NormalizedEvent[] = [e];
    seen.add(key(e));
    for (let i = 0; i < group.length; i++)
      for (const f of all)
        if (!seen.has(key(f)) && eligible(group[i], f, aliases, tournaments)) {
          seen.add(key(f));
          group.push(f);
        }
    const valid =
      group.length > 1 &&
      new Set(group.map((x) => x.provider)).size === group.length &&
      !group.some((x) => conflicts.has(key(x))) &&
      group.every((x, i) =>
        group.slice(i + 1).every((y) => eligible(x, y, aliases, tournaments)),
      );
    if (valid) matched.push(comparison(group, aliases, tournaments));
    else
      for (const x of group)
        unmatched.push({
          provider: x.provider,
          eventId: x.eventId,
          reason:
            group.length > 1 || conflicts.has(key(x))
              ? "ambiguous"
              : all.some(
                    (f) =>
                      f.provider !== x.provider &&
                      f.esport === x.esport &&
                      pair(f, aliases) === pair(x, aliases),
                  )
                ? "time_or_status_mismatch"
                : "no_team_pair",
        });
  }
  return { matched, unmatched, notApplicable };
}
function comparison(
  group: NormalizedEvent[],
  aliases: PersistedTeamAliases,
  tournaments: PersistedTournamentAliases,
) {
  const e = group[0];
  const canonicalSides = [e.teamA, e.teamB].map((name) =>
    canonicalTeamName(name, e.esport, aliases),
  );
  const namesForSide = (side: number) =>
    group.map((x) => {
      const names = [x.teamA, x.teamB];
      const mapped = names.map((name) =>
        canonicalTeamName(name, x.esport, aliases),
      );
      return mapped[side] === canonicalSides[side] ||
        abbreviatedTeamName(mapped[side], canonicalSides[side]) ||
        abbreviatedTeamName(canonicalSides[side], mapped[side]) ||
        inflectedTeamName(mapped[side], canonicalSides[side]) ||
        oneEditTeamName(mapped[side], canonicalSides[side])
        ? mapped[side]
        : mapped[1 - side];
    });
  const fuller = (side: number) =>
    namesForSide(side).sort(
      (a, b) => b.length - a.length || a.localeCompare(b),
    )[0];
  const teamAKey = fuller(0);
  const teamBKey = fuller(1);
  const inferredAliases = namesForSide(0)
    .concat(namesForSide(1))
    .flatMap((name) => {
      const target = namesForSide(0).includes(name) ? teamAKey : teamBKey;
      return name !== target &&
        (abbreviatedTeamName(name, target) ||
          inflectedTeamName(name, target) ||
          oneEditTeamName(name, target))
        ? [{ esport: e.esport, alias: name, canonical: target }]
        : [];
    });
  const reviewedAliases = group.flatMap((x) =>
    [x.teamA, x.teamB].flatMap((name) => {
      const alias = teamAliasKey(name, x.esport);
      const canonical = teamAliases[x.esport][alias];
      return canonical && canonical !== alias
        ? [{ esport: x.esport, alias, canonical }]
        : [];
    }),
  );
  const learnedAliases = [
    ...new Map(
      [...inferredAliases, ...reviewedAliases].map((item) => [
        item.alias,
        item,
      ]),
    ).values(),
  ];
  const teamA = canonicalTeamLabels[e.esport][teamAKey] ?? teamAKey;
  const teamB = canonicalTeamLabels[e.esport][teamBKey] ?? teamBKey;
  const competitions = new Set(
    group.map((x) => tournamentName(x.tournament, x.esport, tournaments)),
  );
  const sameCompetitionAlias = competitions.size === 1;
  const canonicalTournament = tournamentName(
    e.tournament,
    e.esport,
    tournaments,
  );
  const learnedTournamentAliases = sameCompetitionAlias
    ? [...new Set(group.map((x) => tournamentAliasKey(x.tournament, x.esport)))]
        .filter((alias) => alias !== canonicalTournament)
        .map((alias) => ({
          esport: e.esport,
          alias,
          canonical: canonicalTournament,
        }))
    : [];
  const prices = (x: NormalizedEvent, reversed = false) => ({
    eventId: x.eventId,
    rawTeamA: x.rawTeamA,
    rawTeamB: x.rawTeamB,
    normalizedTeamA: x.normalizedTeamA,
    normalizedTeamB: x.normalizedTeamB,
    startsAt: x.startsAt,
    tournament: x.tournament,
    fetchedAt: x.fetchedAt,
    reversed,
    odds: x.markets
      .filter(
        (m) =>
          (m.category === "match_winner" || m.category === "map_winner") &&
          !incompleteWinnerMarket(m, x.teamA, x.teamB),
      )
      .map((m) => ({
        marketId: m.marketId,
        category: m.category,
        map: m.map,
        fetchedAt: m.fetchedAt || x.fetchedAt,
        selections: m.selections.map((s) => ({
          selectionId: s.selectionId,
          name: s.name,
          canonicalSide:
            canonicalTeamName(s.name, x.esport, aliases) ===
            canonicalTeamName(x.teamA, x.esport, aliases)
              ? "teamA"
              : canonicalTeamName(s.name, x.esport, aliases) ===
                  canonicalTeamName(x.teamB, x.esport, aliases)
                ? "teamB"
                : null,
          odds: s.odds,
          suspended: s.suspended,
        })),
      })),
  });
  return {
    canonicalEvent: {
      esport: e.esport,
      tournament: canonicalTournament,
      teamA,
      teamB,
      startsAt: e.startsAt,
    },
    confidence: sameCompetitionAlias ? 1 : 0.9,
    confidenceMeaning: "rule score, not probability",
    evidence: {
      sameTeamPair: true,
      sameCompetitionAlias,
      timeDifferenceSeconds:
        Math.max(...group.map((x) => Date.parse(x.startsAt))) / 1000 -
        Math.min(...group.map((x) => Date.parse(x.startsAt))) / 1000,
    },
    learnedAliases,
    learnedTournamentAliases,
    providers: Object.fromEntries(
      group.map((x) => [
        x.provider,
        prices(
          x,
          canonicalTeamName(e.teamA, e.esport, aliases) !==
            canonicalTeamName(x.teamA, x.esport, aliases),
        ),
      ]),
    ),
  };
}
