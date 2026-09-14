import type { NormalizedEvent } from "../../../shared/domain/normalized-event.js";
import type { Market, RawFields } from "../../../shared/domain/market-model.js";
import type { Esport } from "../../../shared/types/common.js";
import { teamName } from "../../../shared/utils/names.js";
import { EventStartedError } from "../../collection/scheduling-policy.js";
import {
  OFFER_ORIGIN,
  SPORTS,
  object,
  array,
  id,
  type SuperbetCapture,
  type Directory,
  type ObjectValue,
} from "../types/feed.js";

export function validate(c: SuperbetCapture, path: string) {
  const u = new URL(c.source.url);
  if (
    c.provider !== "superbet" ||
    c.status !== 200 ||
    c.source.method !== "GET" ||
    u.origin !== OFFER_ORIGIN ||
    u.pathname !== path ||
    c.source.authenticated !== false ||
    !Number.isFinite(Date.parse(c.capturedAt))
  )
    throw Error("Invalid Superbet capture provenance");
  return object(c.data);
}
export function parseDirectory(c: SuperbetCapture): Directory {
  const body = validate(c, "/v2/pt-BR/struct");
  if (body.error !== false) throw Error("Structure failed");
  const d = object(body.data);
  return {
    tournaments: new Map(
      array(d.tournaments).flatMap((x): [string, string][] => {
        const t = object(x),
          name = object(t.localNames)["pt-BR"];
        // The global directory includes unrelated tournaments without a translation.
        return typeof name === "string" && name.trim()
          ? [[id(t.id), name]]
          : [];
      }),
    ),
    outcomes: new Map(
      array(d.outcomes).map((x) => {
        const o = object(x);
        return [id(o.id), typeof o.columnName === "string" ? o.columnName : ""];
      }),
    ),
  };
}
const raw = (v: ObjectValue): RawFields =>
  Object.fromEntries(
    Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => [k, typeof x === "string" ? x : JSON.stringify(x)]),
  );
const number = (x: unknown): number | null =>
  x === undefined || x === null || x === ""
    ? null
    : Number.isFinite(Number(x))
      ? Number(x)
      : null;
function suspension(v: unknown): boolean | null {
  if (v === "active" || v === 1) return false;
  if (v === "suspended" || v === "inactive" || v === "blocked") return true;
  return null;
}
const winnerTypes: Record<Esport, { match: number; map: number }> = {
  cs2: { match: 2483, map: 2484 },
  lol: { match: 2519, map: 2512 },
  valorant: { match: 232494, map: 232498 },
};
function markets(
  odds: unknown[],
  esport: Esport,
  teams: string[],
  directory: Directory,
  at: string,
): Market[] {
  const groups = new Map<string, Market>();
  const seen = new Map<string, string>();
  for (const value of odds) {
    const o = object(value);
    if (Number(o.offerStateId) !== 1) continue;
    const selectionId = id(o.uuid),
      signature = JSON.stringify(o);
    if (seen.has(selectionId)) {
      if (seen.get(selectionId) !== signature)
        throw Error("Conflicting selection");
      continue;
    }
    seen.set(selectionId, signature);
    const marketId = id(o.marketUuid),
      type = Number(o.marketId),
      spec = o.specifiers ? object(o.specifiers) : {};
    const mapValue = number(spec.mapnr);
    if (mapValue !== null && (!Number.isInteger(mapValue) || mapValue < 1))
      throw Error("Invalid map");
    const category =
      type === winnerTypes[esport].match
        ? "match_winner"
        : type === winnerTypes[esport].map
          ? "map_winner"
          : "unknown";
    if (category === "map_winner" && mapValue === null)
      throw Error("Missing structured map");
    const map =
      mapValue ??
      number(
        id(o.marketName)
          .match(/(?:^(\d+)[°º]?\s*Mapa|^Mapa\s+(\d+))/i)
          ?.slice(1)
          .find(Boolean),
      );
    const price = number(o.price);
    if (
      o.price !== undefined &&
      o.price !== null &&
      (price === null || price <= 1)
    )
      throw Error("Invalid odds");
    const template = directory.outcomes.get(String(o.outcomeId)) || "";
    const side =
      o.code === "1" || o.name === "1" || template.includes("{$competitor1}")
        ? 0
        : o.code === "2" ||
            o.name === "2" ||
            template.includes("{$competitor2}")
          ? 1
          : null;
    const name =
      category !== "unknown" && side !== null ? teams[side] : id(o.name);
    if (category !== "unknown" && !teams.includes(name))
      throw Error("Unresolved winner side");
    let m = groups.get(marketId);
    if (!m) {
      m = {
        marketId,
        rawMarketId: id(o.marketId),
        category,
        name: id(o.marketName),
        groupId: null,
        groupName: null,
        map,
        line: number(spec.total),
        suspended: null,
        inPlay: false,
        selections: [],
        fetchedAt: at,
        raw: raw({
          marketId: o.marketId,
          marketUuid: o.marketUuid,
          specifiers: spec,
          marketGroupOrder: o.marketGroupOrder ?? null,
        }),
      };
      groups.set(marketId, m);
    }
    if (
      m.rawMarketId !== String(o.marketId) ||
      m.map !== map ||
      m.name !== o.marketName
    )
      throw Error("Conflicting market identity");
    m.selections.push({
      selectionId,
      name,
      odds: price,
      line: number(spec.total),
      side: null,
      suspended: o.display === false ? true : suspension(o.status),
      inPlay: false,
      raw: raw(o),
    });
  }
  for (const m of groups.values()) {
    m.suspended = m.selections.every((s) => s.suspended === true)
      ? true
      : m.selections.every((s) => s.suspended === false)
        ? false
        : null;
    if (
      m.category !== "unknown" &&
      (m.selections.length !== 2 ||
        new Set(m.selections.map((s) => s.name)).size !== 2)
    )
      throw Error("Incomplete winner market");
  }
  if (!groups.size) throw Error("No prematch markets");
  return [...groups.values()];
}
function event(
  e: ObjectValue,
  odds: unknown[],
  esport: Esport,
  c: SuperbetCapture,
  directory: Directory,
): NormalizedEvent {
  if (Number(e.sportId) !== SPORTS[esport]) throw Error("Wrong esport");
  const status = e.metadata
    ? object(e.metadata).status
    : Array.isArray(e.streams) &&
        e.streams.length === 1 &&
        e.streams[0] === "PREMATCH"
      ? "NOT_STARTED"
      : undefined;
  if (status !== "NOT_STARTED") {
    if (["LIVE", "IN_PROGRESS", "ENDED", "FINISHED"].includes(String(status)))
      throw new EventStartedError();
    throw Error("Unknown event status");
  }
  const teams = id(e.matchName).split("·");
  if (teams.length !== 2 || teams.some((t) => !t.trim()))
    throw Error("Not a two-team event");
  const tournament = directory.tournaments.get(id(e.tournamentId));
  if (!tournament) throw Error("Missing tournament");
  const startsAt = new Date(
    id(e.matchDate).replace(" ", "T").replace(/Z$/, "") + "Z",
  ).toISOString();
  const offer = object(e.offerStateStatus)["1"];
  const suspended = suspension(offer);
  if (suspended === null) throw Error("Unknown prematch offer state");
  return {
    provider: "superbet",
    esport,
    eventId: id(e.eventId),
    teamA: teams[0],
    teamB: teams[1],
    rawTeamA: teams[0],
    rawTeamB: teams[1],
    normalizedTeamA: teamName(teams[0], esport),
    normalizedTeamB: teamName(teams[1], esport),
    tournament,
    startsAt,
    status: suspended ? "suspended" : "scheduled",
    suspended,
    inPlay: false,
    fetchedAt: c.capturedAt,
    markets: markets(odds, esport, teams, directory, c.capturedAt),
    provenance: {
      source: c.source,
      sportId: e.sportId,
      tournamentId: e.tournamentId,
      categoryId: e.categoryId,
      homeTeamId: e.homeTeamId,
      awayTeamId: e.awayTeamId,
      rawEvent: e,
    },
  };
}
export function parseListing(
  c: SuperbetCapture,
  esport: Esport,
  structure: SuperbetCapture,
): NormalizedEvent[] {
  const b = validate(c, "/v3/pt-BR/events"),
    u = new URL(c.source.url);
  if (
    u.searchParams.get("index") !== "active-prematch" ||
    u.searchParams.get("sports") !== String(SPORTS[esport])
  )
    throw Error("Wrong listing scope");
  if (
    Date.parse(u.searchParams.get("endDate") || "") -
      Date.parse(u.searchParams.get("startDate") || "") !==
    180 * 86400000
  )
    throw Error("Incomplete listing date window");
  const directory = parseDirectory(structure),
    found = new Map<string, NormalizedEvent>();
  for (const value of array(b.events)) {
    const v = object(value),
      f = object(v.fixture),
      metadata = object(v.inplay_stats_metadata);
    if (v.is_full_market_update !== true) throw Error("Partial listing");
    if (metadata.status !== "NOT_STARTED") {
      if (
        ["LIVE", "IN_PROGRESS", "ENDED", "FINISHED"].includes(
          String(metadata.status),
        )
      )
        continue;
      throw Error("Unknown listing event status");
    }
    const odds = array(v.markets).flatMap((x) => {
      const m = object(x);
      return array(m.odds).map((x) => {
        const o = object(x),
          meta = object(o.metadata);
        return {
          ...meta,
          uuid: o.uuid,
          price: o.price,
          status: o.status,
          display: o.display,
          marketUuid: meta.market_line_uuid,
          marketId: m.id,
          marketName: m.name,
          offerStateId: meta.offer_state_id,
          outcomeId: meta.outcome_id,
          specifiers: meta.specifiers,
        };
      });
    });
    const e = event(
      {
        eventId: v.event_id,
        sportId: f.sport_id,
        categoryId: f.category_id,
        tournamentId: f.tournament_id,
        homeTeamId: f.home_team_id,
        awayTeamId: f.away_team_id,
        matchDate: f.utc_date,
        matchName: f.event_name,
        offerStateStatus: f.offer_state_status,
        metadata,
      },
      odds,
      esport,
      c,
      directory,
    );
    e.provenance.rawEvent = v;
    const previous = found.get(e.eventId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(e))
      throw Error("Conflicting duplicate event");
    found.set(e.eventId, e);
  }
  if (!found.size) throw Error("Empty feed is not authoritative removal");
  return [...found.values()];
}
export function parseDetail(
  c: SuperbetCapture,
  esport: Esport,
  eventId: string,
  structure: SuperbetCapture,
): NormalizedEvent {
  const body = validate(c, "/v2/pt-BR/events/" + eventId);
  if (body.error !== false) throw Error("Detail failed");
  const values = array(body.data);
  if (values.length !== 1) throw Error("Incomplete detail response");
  const e = object(values[0]);
  if (String(e.eventId) !== eventId) throw Error("Wrong event");
  const odds = array(e.odds);
  const expected = Number(object(object(e.counts).odds)["1"]);
  const actual = new Set(
    odds
      .map(object)
      .filter((o) => Number(o.offerStateId) === 1)
      .map((o) => id(o.uuid)),
  ).size;
  if (!Number.isInteger(expected) || expected < 1 || actual !== expected)
    throw Error("Incomplete prematch odds coverage");
  return event(e, odds, esport, c, parseDirectory(structure));
}
