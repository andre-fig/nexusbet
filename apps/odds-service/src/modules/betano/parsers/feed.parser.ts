import type { Esport, Source } from "../../../shared/types/common.js";
import type { Market, RawFields } from "../../../shared/domain/market-model.js";
import type { NormalizedEvent } from "../../../shared/domain/normalized-event.js";
import { names } from "../../../shared/utils/names.js";
export const origin = "https://www.betano.bet.br";
export const regions: Record<Esport, { id: string; name: string }> = {
  cs2: { id: "189374", name: "Counter Strike" },
  lol: { id: "189377", name: "League of Legends" },
  valorant: { id: "189513", name: "Valorant" },
};
export interface BetanoCapture {
  provider: "betano";
  capturedAt: string;
  source: Source;
  data: Record<string, any>;
  requestHeaderNames?: string[];
  cookieNames?: string[];
  status: number;
}
export function safeUrl(value: string) {
  const u = new URL(value);
  if (
    u.origin !== origin ||
    !/^\/api\/(sport\/esports\/|odds\/[^/]+\/\d+\/)/.test(u.pathname) ||
    /criar-aposta/.test(u.pathname)
  )
    throw Error("Not a read-only Betano sports feed");
  for (const k of u.searchParams.keys())
    if (!["req", "sl", "market", "sort", "type", "page"].includes(k))
      throw Error("Unobserved query parameter");
  return u.href;
}
function text(v: unknown, key: string): string {
  if (typeof v !== "string" || !v.trim()) throw Error("Missing " + key);
  return v;
}
function id(v: unknown): string {
  const s = String(v);
  if (!/^\d+$/.test(s)) throw Error("Invalid protocol ID");
  return s;
}
function raw(v: any): RawFields {
  return Object.fromEntries(
    Object.entries(v).map(([k, v]) => [
      k,
      typeof v === "string" ? v : JSON.stringify(v),
    ]),
  );
}
function suspension(v: any): boolean | null {
  if (typeof v.suspended === "boolean") return v.suspended;
  if (typeof v.isSuspended === "boolean") return v.isSuspended;
  return null;
}
function mergedState(...states: (boolean | null)[]): boolean | null {
  return states.includes(true) ? true : states.includes(false) ? false : null;
}
function unique<T>(items: T[], key: (v: T) => string): T[] {
  const m = new Map<string, T>();
  for (const v of items) {
    const k = key(v),
      old = m.get(k);
    if (old && JSON.stringify(old) !== JSON.stringify(v))
      throw Error("Conflicting duplicate " + k);
    m.set(k, v);
  }
  return [...m.values()];
}
export function parseEvent(
  e: any,
  c: BetanoCapture,
  esport: Esport,
): NormalizedEvent {
  if (e.sportId !== "ESPS" || String(e.regionId) !== regions[esport].id)
    throw Error("Wrong sport/region");
  const eventId = id(e.id);
  if (!Array.isArray(e.participants) || e.participants.length !== 2)
    throw Error("Expected two teams");
  const teamA = text(e.participants[0].name, "team"),
    teamB = text(e.participants[1].name, "team");
  if (typeof e.startTime !== "number" || !Number.isFinite(e.startTime))
    throw Error("Invalid startTime");
  const startsAt = new Date(e.startTime).toISOString();
  const url = text(e.url, "event URL");
  if (!new RegExp("^/(odds|live)/[^/]+/" + eventId + "/$").test(url))
    throw Error("Unexpected event route");
  const inPlay = e.liveNow === true || url.startsWith("/live/");
  const suspended = suspension(e);
  const markets = unique<Market>(
    (e.markets ?? []).map((m: any) => {
      const rawMarketId = id(m.id),
        name = text(m.name, "market name");
      const found = /\bMapa\s+(\d+)\b/i.exec(name);
      const map = found ? Number(found[1]) : null;
      let category = "unknown";
      if (m.type === "H2HT" && m.typeId === 3183 && /^Vencedor$/i.test(name))
        category = "match_winner";
      if (
        m.type === "TMPW" &&
        m.typeId === 3185 &&
        map !== null &&
        map > 0 &&
        /^Vencedor do mapa\b/i.test(name)
      )
        category = "map_winner";
      const winner = category !== "unknown";
      const ms = mergedState(suspended, suspension(m));
      const selections = unique<any>(
        (m.selections ?? []).map((s: any) => {
          const ss = mergedState(ms, suspension(s));
          const odds = s.price == null ? null : s.price;
          if (
            odds !== null &&
            (typeof odds !== "number" || !Number.isFinite(odds) || odds <= 1)
          )
            throw Error("Invalid decimal odds");
          if (odds === null && ss !== true)
            throw Error("Unexplained missing price");
          return {
            selectionId: id(s.id),
            name: text(s.name, "selection"),
            odds,
            line: winner
              ? null
              : typeof s.handicap === "number"
                ? s.handicap
                : null,
            side: null,
            suspended: ss,
            inPlay,
            raw: raw(s),
          };
        }),
        (s) => s.selectionId,
      );
      if (
        winner &&
        (selections.length !== 2 ||
          !selections.every((s) => [teamA, teamB].includes(s.name)) ||
          new Set(selections.map((s) => s.name)).size !== 2)
      )
        throw Error("Incomplete winner market");
      return {
        marketId: eventId + ":" + rawMarketId,
        rawMarketId,
        category,
        name,
        map,
        line: winner
          ? null
          : typeof m.handicap === "number"
            ? m.handicap
            : null,
        suspended: ms,
        inPlay,
        groupId: null,
        groupName: null,
        selections,
        raw: raw(m),
        fetchedAt: c.capturedAt,
      };
    }),
    (m) => m.marketId,
  );
  return {
    provider: "betano",
    esport,
    eventId,
    tournament: text(e.leagueName, "league"),
    teamA,
    teamB,
    ...names(teamA, teamB, esport),
    startsAt,
    status: inPlay ? "live" : suspended === true ? "suspended" : "scheduled",
    markets,
    inPlay,
    suspended,
    fetchedAt: c.capturedAt,
    provenance: {
      sportId: e.sportId,
      regionId: e.regionId,
      leagueId: e.leagueId,
      url: e.url,
      participants: e.participants,
      rawEvent: e,
    },
  };
}
export function validate(c: BetanoCapture) {
  if (c.provider !== "betano" || c.status !== 200 || c.source.method !== "GET")
    throw Error("Invalid capture");
  safeUrl(c.source.url);
  if (
    !Number.isFinite(Date.parse(c.capturedAt)) ||
    new Date(c.capturedAt).toISOString() !== c.capturedAt ||
    !c.data
  )
    throw Error("Invalid capture time/data");
}
export function parseListing(
  c: BetanoCapture,
  esport: Esport,
): NormalizedEvent[] {
  validate(c);
  if (
    !new URL(c.source.url).pathname.startsWith("/api/sport/esports/") ||
    !Array.isArray(c.data.blocks)
  )
    throw Error("Expected listing blocks");
  return unique<NormalizedEvent>(
    c.data.blocks.flatMap((b: any) => {
      if (!Array.isArray(b.events)) throw Error("Missing block events");
      return b.events
        .filter((e: any) => String(e.regionId) === regions[esport].id)
        .map((e: any) => parseEvent(e, c, esport));
    }),
    (e) => e.eventId,
  ).filter((e) => e.status !== "live");
}
export function parseDetail(
  c: BetanoCapture,
  esport: Esport,
  eventId: string,
): NormalizedEvent {
  validate(c);
  if (
    !new URL(c.source.url).pathname.endsWith("/" + id(eventId) + "/") ||
    !c.data.event
  )
    throw Error("Wrong detail route");
  const e = parseEvent(c.data.event, c, esport);
  if (e.eventId !== eventId || e.inPlay) throw Error("Wrong/live event");
  if (!e.markets.length) throw Error("Empty detail");
  return e;
}
