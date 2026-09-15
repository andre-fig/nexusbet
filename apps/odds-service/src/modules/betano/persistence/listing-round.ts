import {
  parseListing,
  validate,
  regions,
  type BetanoCapture,
} from "../parsers/feed.parser.js";
import type { Esport } from "../../../shared/types/common.js";
import type { NormalizedEvent } from "../../../shared/domain/normalized-event.js";

export interface ListingRound {
  kind: "listing";
  esport: Esport;
  directory: BetanoCapture;
  regionId: string;
  expectedLeagues: string[];
  captures: BetanoCapture[];
}

/** Same coverage validation used before both deferred publication and journal ingestion. */
export function normalizeListingRound(round: ListingRound) {
  let at: string,
    source: BetanoCapture["source"],
    scope: string,
    matches: NormalizedEvent[];
  validate(round.directory);
  const advertised = round.directory.data.regionGroups
    ?.flatMap((g: any) => g.regions)
    .find((r: any) => String(r.id) === regions[round.esport].id);
  if (!advertised || round.regionId !== regions[round.esport].id)
    throw Error("Missing region coverage");
  const expected = new Set<string>(
    advertised.leagues.map((l: any) => String(l.id)),
  );
  if (
    expected.size !== round.expectedLeagues.length ||
    round.expectedLeagues.some((id) => !expected.has(id))
  )
    throw Error("Partial competition coverage");
  const actual = new Set<string>();
  const found = new Map<string, NormalizedEvent>();
  for (const c of round.captures) {
    const items = parseListing(c, round.esport);
    for (const b of c.data.blocks) {
      if (!expected.has(String(b.id))) throw Error("Unexpected competition");
      actual.add(String(b.id));
    }
    const sl = new URL(c.source.url).searchParams.get("sl");
    if (c.data.blocks.length === 0 && sl && expected.has(sl)) actual.add(sl);
    for (const e of items) {
      const prior = found.get(e.eventId);
      if (prior && prior.provenance.leagueId !== e.provenance.leagueId)
        throw Error("Conflicting event competition");
      if (!prior || prior.fetchedAt < e.fetchedAt) found.set(e.eventId, e);
    }
  }
  if ([...expected].some((id) => !actual.has(id)))
    throw Error("Incomplete listing round");
  if (!round.captures.length) throw Error("Empty capture round");
  const times = round.captures.map((c) => c.capturedAt).sort();
  at = times.at(-1)!;
  if (Date.parse(at) - Date.parse(times[0]) > 600000)
    throw Error("Listing round too old");
  source = round.captures.at(-1)!.source;
  scope = "betano:list:" + round.esport;
  matches = [...found.values()];

  return { at, source, scope, matches, coverage: [...expected] };
}
