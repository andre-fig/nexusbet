import { parseCapture, records } from "../parsers/list.parser.js";
import { parseDetail, type DetailResult } from "../parsers/coupon.parser.js";
import type { Capture } from "../types/model.js";
import type {
  DetailedMatch,
  Market,
} from "../../../shared/domain/market-model.js";

export interface DetailRound {
  eventId: string;
  listing: Capture;
  captures: Capture[];
  coverage: "main" | "all_tabs";
}

export function eventRoute(listing: Capture, eventId: string): string {
  const row = records(listing.body).find(
    (r) =>
      r.type === "PA" &&
      r.fields.ID?.startsWith("PC") &&
      r.fields.FI === eventId,
  )?.fields;
  if (!row?.PD) throw Error("Event absent from current listing");
  return row.PD.split("#P^")[0].replace(/#?$/, "#");
}

export const isReadOnlyTab = (tab: { pd: string; name: string }) =>
  !/#I99#/.test(tab.pd) && !/^criar aposta$/i.test(tab.name);

export function normalizeRound(round: DetailRound): {
  match: DetailedMatch;
  parts: DetailResult[];
  coverage: DetailRound["coverage"];
  routes: string[];
} {
  if (
    !["main", "all_tabs"].includes(round.coverage) ||
    !Array.isArray(round.captures) ||
    !round.captures.length
  )
    throw Error("Invalid detail round");
  const listing = parseCapture(round.listing);
  const event = listing.matches.find((m) => m.eventId === round.eventId);
  if (!event) throw Error("Event not found in listing");
  const base = eventRoute(round.listing, event.eventId);
  const routes = round.captures.map(
    (c) => new URL(c.source.url).searchParams.get("pd") || "",
  );
  if (routes[0] !== base || new Set(routes).size !== routes.length)
    throw Error("Detail main route missing or duplicated");
  const parts = round.captures.map((c) => {
    if (
      Date.parse(c.capturedAt) < Date.parse(round.listing.capturedAt) ||
      Date.parse(c.capturedAt) - Date.parse(round.listing.capturedAt) > 600000
    )
      throw Error("Detail context is stale or from the future");
    return parseDetail(c, {
      match: event,
      inPlay: listing.provenance[event.eventId].inPlay,
    });
  });
  const expected = parts[0].tabs.filter(isReadOnlyTab).map((t) => t.pd);
  if (!expected.includes(base)) throw Error("Main tab not advertised");
  if (routes.some((r) => !expected.includes(r)))
    throw Error("Unadvertised detail route");
  if (
    round.coverage === "all_tabs" &&
    (expected.length !== routes.length ||
      expected.some((r) => !routes.includes(r)))
  )
    throw Error("Incomplete detail tab coverage");
  if (round.coverage === "main" && routes.length !== 1)
    throw Error("Main-only round contains extra tabs");
  const markets = new Map<string, Market>();
  for (const p of [...parts].sort((a, b) =>
    a.match.fetchedAt.localeCompare(b.match.fetchedAt),
  ))
    for (const m of p.match.markets) markets.set(m.marketId, m);
  const latest = [...parts]
    .sort((a, b) => a.match.fetchedAt.localeCompare(b.match.fetchedAt))
    .at(-1)!;
  return {
    match: { ...latest.match, markets: [...markets.values()] },
    parts,
    coverage: round.coverage,
    routes,
  };
}
