import type { NormalizedEvent } from "../../../shared/domain/normalized-event.js";
import type { Market, RawFields } from "../../../shared/domain/market-model.js";
import type { Esport } from "../../../shared/types/common.js";
import { names, tournamentName } from "../../../shared/utils/names.js";
import { EventStartedError } from "../../collection/scheduling-policy.js";
import {
  API_BASE,
  CATEGORIES,
  object,
  rows,
  id,
  text,
  type FeedObject,
  type EstrelaBetCapture,
} from "../types/feed.js";
// Only public protocol fields enter raw; request/session envelopes are never archived here.
function raw(v: FeedObject): RawFields {
  return Object.fromEntries(
    [
      "id",
      "name",
      "typeId",
      "sportMarketId",
      "sv",
      "oddStatus",
      "competitorId",
      "price",
      "shortName",
      "status",
      "extId",
      "feedEventId",
      "catId",
      "champId",
      "sportId",
      "startDate",
      "et",
      "rc",
    ]
      .filter((k) => v[k] !== undefined)
      .map((k) => [
        k,
        typeof v[k] === "string" ? (v[k] as string) : JSON.stringify(v[k]),
      ]),
  );
}
function index(v: unknown): Map<string, FeedObject> {
  const out = new Map<string, FeedObject>();
  for (const item of rows(v)) {
    const key = id(item.id),
      previous = out.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(item))
      throw Error("Conflicting EstrelaBet entity " + key);
    out.set(key, item);
  }
  return out;
}
function required(map: Map<string, FeedObject>, key: unknown): FeedObject {
  const v = map.get(id(key));
  if (!v) throw Error("Missing EstrelaBet reference " + id(key));
  return v;
}
function ids(v: unknown): string[] {
  if (!Array.isArray(v)) throw Error("Missing EstrelaBet references");
  return [
    ...new Set(
      v
        .flat(Infinity)
        .filter((v) => v !== 0 && v !== null)
        .map(id),
    ),
  ];
}
function capture(c: EstrelaBetCapture, kind: "list" | "detail") {
  const u = new URL(c.source.url);
  if (
    c.provider !== "estrelabet" ||
    c.status !== 200 ||
    !Number.isFinite(Date.parse(c.capturedAt)) ||
    c.source.authenticated !== false ||
    c.source.method !== "GET" ||
    u.origin !== new URL(API_BASE).origin ||
    u.pathname !==
      new URL(API_BASE + (kind === "list" ? "GetUpcoming" : "GetEventDetails"))
        .pathname ||
    u.searchParams.get("integration") !== "estrelabet"
  )
    throw Error("Invalid EstrelaBet provenance");
}
function mapNumber(m: FeedObject, groups: FeedObject[]): number | null {
  if (m.typeId === 330 || m.typeId === 395) {
    const n = Number(m.sv);
    if (!Number.isSafeInteger(n) || n < 1)
      throw Error("Missing map winner specifier");
    return n;
  }
  const groupMaps = groups
    .map((g) => /^Mapa (\d+)$/i.exec(String(g.name))?.[1])
    .filter(Boolean);
  const unique = [...new Set(groupMaps)];
  return unique.length === 1 ? Number(unique[0]) : null;
}
function market(
  m: FeedObject,
  odds: Map<string, FeedObject>,
  at: string,
  groups: FeedObject[] = [],
): Market {
  const map = mapNumber(m, groups),
    category =
      m.typeId === 30001
        ? "match_winner"
        : m.typeId === 330 || m.typeId === 395
          ? "map_winner"
          : "unknown";
  const references = ids(m.oddIds ?? m.desktopOddIds),
    selections = references.map((key) => {
      const o = required(odds, key);
      const n = o.price;
      return {
        selectionId: key,
        name: text(o.name),
        odds: typeof n === "number" && Number.isFinite(n) && n > 1 ? n : null,
        line: null,
        side: null,
        suspended: typeof o.oddStatus === "number" ? o.oddStatus !== 0 : null,
        inPlay: false,
        raw: raw(o),
      };
    });
  if (category !== "unknown" && selections.length !== 2)
    throw Error("Incomplete EstrelaBet winner market");
  const group =
    groups.find((g) => /^Mapa \d+$/i.test(String(g.name))) ?? groups[0];
  return {
    marketId: id(m.id),
    rawMarketId: id(m.id),
    category,
    name: text(m.name),
    map,
    line: null,
    groupId: group ? id(group.id) : null,
    groupName: group ? text(group.name) : null,
    inPlay: false,
    suspended:
      selections.length && selections.every((s) => s.suspended === true)
        ? true
        : selections.some((s) => s.suspended === false)
          ? false
          : null,
    selections,
    fetchedAt: at,
    raw: {
      ...raw(m),
      groups: JSON.stringify(groups.map((g) => ({ id: g.id, name: g.name }))),
    },
  };
}
function event(
  e: FeedObject,
  esport: Esport,
  teams: FeedObject[],
  champ: FeedObject,
  markets: Market[],
  c: EstrelaBetCapture,
): NormalizedEvent {
  if (teams.length !== 2) throw Error("EstrelaBet event must have two teams");
  const teamA = text(teams[0].name),
    teamB = text(teams[1].name),
    startsAt = text(e.startDate),
    tournament = text(champ.name);
  if (!Number.isFinite(Date.parse(startsAt)))
    throw Error("Invalid EstrelaBet startDate");
  return {
    provider: "estrelabet",
    eventId: id(e.id),
    esport,
    teamA,
    teamB,
    ...names(teamA, teamB, esport),
    tournament,
    startsAt: new Date(startsAt).toISOString(),
    status: "scheduled",
    inPlay: false,
    suspended: null,
    markets,
    fetchedAt: c.capturedAt,
    provenance: {
      source: c.source,
      raw: raw(e),
      rawTournament: tournament,
      normalizedTournament: tournamentName(tournament, esport),
      categoryId: CATEGORIES[esport],
      champId: id(champ.id),
      competitorIds: teams.map((t) => id(t.id)),
      coverage: "prematch",
    },
  };
}
/** All pages are required before a list can replace a scope. No partial pagination publication. */
export function parseListing(
  c: EstrelaBetCapture,
  esport: Esport,
): NormalizedEvent[] {
  capture(c, "list");
  const pages = c.data.pages;
  if (!pages?.length) throw Error("Missing EstrelaBet pages");
  const result = new Map<string, NormalizedEvent>();
  for (let i = 0; i < pages.length; i++) {
    const p = object(pages[i]);
    if (p.page !== i + 1 || p.pageCount !== pages.length)
      throw Error("Incomplete EstrelaBet pagination");
    const markets = index(p.markets),
      odds = index(p.odds),
      teams = index(p.competitors),
      champs = index(p.champs);
    for (const e of rows(p.events)) {
      if (e.sportId !== 145 || e.catId !== CATEGORIES[esport]) continue;
      if (!Number.isFinite(Date.parse(text(e.startDate))))
        throw Error("Invalid EstrelaBet date");
      if (
        e.status === 1 ||
        Date.parse(text(e.startDate)) <= Date.parse(c.capturedAt)
      )
        continue;
      if (e.status !== 0) throw Error("Unknown EstrelaBet event status");
      if (!ids(e.marketIds).length)
        throw Error("Empty EstrelaBet event markets");
      const value = event(
        e,
        esport,
        ids(e.competitorIds).map((k) => required(teams, k)),
        required(champs, e.champId),
        ids(e.marketIds).map((k) =>
          market(required(markets, k), odds, c.capturedAt),
        ),
        c,
      );
      const prev = result.get(value.eventId);
      if (prev && JSON.stringify(prev) !== JSON.stringify(value))
        throw Error("Conflicting EstrelaBet event across pages");
      result.set(value.eventId, value);
    }
  }
  return [...result.values()].sort(
    (a, b) =>
      a.startsAt.localeCompare(b.startsAt) ||
      a.eventId.localeCompare(b.eventId),
  );
}
export function parseDetail(
  c: EstrelaBetCapture,
  esport: Esport,
  eventId: string,
): NormalizedEvent {
  capture(c, "detail");
  const d = object(c.data.detail);
  if (
    new URL(c.source.url).searchParams.get("eventId") !== eventId ||
    id(d.id) !== eventId ||
    object(d.category).id !== CATEGORIES[esport] ||
    object(d.sport).id !== 145
  )
    throw Error("Wrong EstrelaBet detail event");
  if (!Number.isFinite(Date.parse(text(d.startDate))))
    throw Error("Invalid EstrelaBet date");
  // Detail omits status for scheduled matches; never infer finished or ingest live after kickoff.
  if (
    Date.parse(text(d.startDate)) <= Date.parse(c.capturedAt) ||
    d.status === 1 ||
    d.liveTime !== undefined
  )
    throw new EventStartedError();
  if (d.status !== undefined && d.status !== 0)
    throw Error("Unknown EstrelaBet event status");
  const odds = index(d.odds),
    groups = rows(d.marketGroups),
    main = index(d.markets);
  // Child bundles have not been observed. Refuse partial detail rather than silently drop a new protocol shape.
  if (
    rows(d.childMarkets ?? []).length ||
    rows(d.childMarketGroups ?? []).length
  )
    throw Error("Unsupported EstrelaBet child market structure");
  const markets = [...main.values()].map((m) =>
    market(
      m,
      odds,
      c.capturedAt,
      groups.filter((g) => ids(g.marketIds).includes(id(m.id))),
    ),
  );
  if (!markets.some((m) => m.selections.length))
    throw Error("Empty EstrelaBet detail");
  return event(d, esport, rows(d.competitors), object(d.champ), markets, c);
}
