import type { NormalizedEvent } from "../../shared/domain/normalized-event.js";
import { tournamentName } from "../../shared/utils/names.js";
import { canonicalTeamName } from "./team-aliases.js";
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
function pair(e: NormalizedEvent) {
  return [
    canonicalTeamName(e.teamA, e.esport),
    canonicalTeamName(e.teamB, e.esport),
  ]
    .sort()
    .join("|");
}
function eligible(e: NormalizedEvent, f: NormalizedEvent) {
  return (
    e.provider !== f.provider &&
    e.esport === f.esport &&
    pair(e) === pair(f) &&
    e.status === "scheduled" &&
    f.status === "scheduled" &&
    Date.parse(e.startsAt) === Date.parse(f.startsAt)
  );
}
/** A component must be a complete, one-event-per-provider clique. No transitive fuzzy joins. */
export function compareAllProviders(
  events: NormalizedEvent[],
  eligibleProviders: readonly string[] | EligibleProviders = [
    ...new Set(events.map((event) => event.provider)),
  ],
) {
  const key = (e: NormalizedEvent) => e.provider + ":" + e.eventId;
  const unique = new Map<string, NormalizedEvent>();
  const conflicts = new Set<string>();
  for (const e of events) {
    const prior = unique.get(key(e));
    if (prior && JSON.stringify(prior) !== JSON.stringify(e))
      conflicts.add(key(e));
    unique.set(key(e), e);
  }
  const providersFor = (event: NormalizedEvent) =>
    new Set(
      Array.isArray(eligibleProviders)
        ? eligibleProviders
        : ((eligibleProviders as EligibleProviders)[event.esport] ?? []),
    );
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
        if (!seen.has(key(f)) && eligible(group[i], f)) {
          seen.add(key(f));
          group.push(f);
        }
    const valid =
      group.length > 1 &&
      new Set(group.map((x) => x.provider)).size === group.length &&
      !group.some((x) => conflicts.has(key(x))) &&
      group.every((x, i) => group.slice(i + 1).every((y) => eligible(x, y)));
    if (valid) matched.push(comparison(group));
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
                      pair(f) === pair(x),
                  )
                ? "time_or_status_mismatch"
                : "no_team_pair",
        });
  }
  return { matched, unmatched, notApplicable };
}
function comparison(group: NormalizedEvent[]) {
  const e = group[0];
  const competitions = new Set(
    group.map((x) => tournamentName(x.tournament, x.esport)),
  );
  const sameCompetitionAlias = competitions.size === 1;
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
        (m) => m.category === "match_winner" || m.category === "map_winner",
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
            canonicalTeamName(s.name, x.esport) ===
            canonicalTeamName(e.teamA, e.esport)
              ? "teamA"
              : canonicalTeamName(s.name, x.esport) ===
                  canonicalTeamName(e.teamB, e.esport)
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
      tournament: tournamentName(e.tournament, e.esport),
      teamA: canonicalTeamName(e.teamA, e.esport),
      teamB: canonicalTeamName(e.teamB, e.esport),
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
    providers: Object.fromEntries(
      group.map((x) => [
        x.provider,
        prices(
          x,
          canonicalTeamName(e.teamA, e.esport) !==
            canonicalTeamName(x.teamA, x.esport),
        ),
      ]),
    ),
  };
}
