import type { NormalizedEvent } from "../../../shared/domain/normalized-event.js";
import type { Market, RawFields } from "../../../shared/domain/market-model.js";
import type { Esport } from "../../../shared/types/common.js";
import { teamName } from "../../../shared/utils/names.js";
import { EventStartedError } from "../../collection/scheduling-policy.js";
import {
  OFFER_ORIGIN,
  PREMATCH_PATH,
  SPORTS,
  object,
  id,
  type BlazeCapture,
  type ObjectValue,
} from "../types/feed.js";
const raw = (value: ObjectValue): RawFields =>
  Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      typeof v === "string" ? v : JSON.stringify(v),
    ]),
  );
function merged(c: BlazeCapture) {
  if (
    c.provider !== "blaze" ||
    c.status !== 200 ||
    c.source.url !== OFFER_ORIGIN + PREMATCH_PATH + "0" ||
    c.source.method !== "GET" ||
    c.source.authenticated !== false ||
    !Number.isFinite(Date.parse(c.capturedAt))
  )
    throw Error("Invalid Blaze provenance");
  const manifest = object(c.data.manifest);
  if (
    !Array.isArray(manifest.top_events_versions) ||
    !Array.isArray(manifest.rest_events_versions)
  )
    throw Error("Missing manifest");
  const versions = [
    ...manifest.top_events_versions,
    ...manifest.rest_events_versions,
  ];
  if (
    !versions.length ||
    new Set(versions).size !== versions.length ||
    versions.length !== c.data.shards.length
  )
    throw Error("Incomplete Blaze snapshot");
  const events = new Map<string, { value: ObjectValue; at: string }>(),
    tournaments: ObjectValue = {};
  for (let i = 0; i < versions.length; i++) {
    const shard = c.data.shards[i],
      d = object(shard.data);
    if (
      shard.version !== versions[i] ||
      d.epoch !== manifest.epoch ||
      d.fixtures_complete !== true ||
      typeof d.generated !== "number" ||
      !Number.isFinite(d.generated) ||
      d.generated > Date.parse(c.capturedAt) + 60000
    )
      throw Error("Invalid Blaze shard");
    if (i < versions.length - 1 && d.version !== versions[i + 1])
      throw Error("Broken Blaze snapshot version chain");
    if (i === versions.length - 1 && d.snapshot_complete !== true)
      throw Error("Unfinished Blaze snapshot");
    Object.assign(tournaments, object(d.tournaments ?? {}));
    for (const [eventId, value] of Object.entries(object(d.events))) {
      if (
        events.has(eventId) &&
        JSON.stringify(events.get(eventId)!.value) !== JSON.stringify(value)
      )
        throw Error("Conflicting Blaze event");
      events.set(eventId, {
        value: object(value),
        at: new Date(d.generated).toISOString(),
      });
    }
  }
  return { events, tournaments, descriptions: object(c.data.descriptions) };
}
function markets(
  input: unknown,
  descriptions: ObjectValue,
  teams: string[],
  at: string,
): Market[] {
  const result: Market[] = [];
  for (const [type, variants] of Object.entries(object(input))) {
    const definition = descriptions[type] ? object(descriptions[type]) : {};
    for (const [specifier, outcomes] of Object.entries(object(variants))) {
      const pairs = specifier
        ? specifier.split("|").map((s) => s.split("="))
        : [];
      if (
        pairs.some((p) => p.length !== 2) ||
        new Set(pairs.map((p) => p[0])).size !== pairs.length
      )
        throw Error("Invalid Blaze specifiers");
      const spec = Object.fromEntries(pairs),
        map = spec.mapnr === undefined ? null : Number(spec.mapnr);
      if (map !== null && (!Number.isInteger(map) || map < 1))
        throw Error("Invalid map number");
      const category =
        type === "186" && !specifier
          ? "match_winner"
          : type === "330" && map !== null
            ? "map_winner"
            : "unknown";
      const selections = Object.entries(object(outcomes)).map(
        ([selectionId, value]) => {
          const o = object(value),
            numeric = typeof o.k === "string" && o.k.trim() ? Number(o.k) : NaN;
          const suspended =
            o.b === 1 ? true : o.b === 0 || o.b === undefined ? false : null;
          const odds = Number.isFinite(numeric) && numeric > 1 ? numeric : null;
          return {
            selectionId,
            name:
              selectionId === "4"
                ? teams[0]
                : selectionId === "5"
                  ? teams[1]
                  : selectionId,
            odds,
            line: null,
            side: null,
            suspended,
            inPlay: false,
            raw: raw(o),
          };
        },
      );
      if (
        category !== "unknown" &&
        (selections.length !== 2 ||
          !selections.some((s) => s.selectionId === "4") ||
          !selections.some((s) => s.selectionId === "5"))
      )
        throw Error("Missing Blaze winner selections");
      const marketId = specifier
        ? `${type}:${pairs
            .sort(([a], [b]) => a.localeCompare(b))
            .map((p) => p.join("="))
            .join("|")}`
        : type;
      const name =
        typeof definition.name === "string"
          ? definition.name.replace("{!mapnr}", String(map))
          : type;
      result.push({
        marketId,
        rawMarketId: type,
        category,
        name,
        map,
        line: null,
        groupId: null,
        groupName: null,
        suspended:
          selections.length && selections.every((s) => s.suspended === true)
            ? true
            : selections.every((s) => s.suspended === false)
              ? false
              : null,
        inPlay: false,
        selections,
        raw: {
          specifier,
          definition: JSON.stringify({
            id: type,
            name: definition.name ?? type,
            market_type: definition.market_type ?? null,
          }),
        },
        fetchedAt: at,
      });
    }
  }
  return result;
}
export function parseListing(
  c: BlazeCapture,
  esport: Esport,
): NormalizedEvent[] {
  if (c.data.projection && c.data.projection !== esport)
    throw Error("Wrong Blaze projection sport");
  const data = merged(c),
    result: NormalizedEvent[] = [];
  for (const [eventId, { value: e, at }] of data.events) {
    const d = object(e.desc);
    if (d.sport !== SPORTS[esport] || d.type !== "match") continue;
    const state = object(e.state),
      starts = Number(d.scheduled) * 1000;
    if (!Number.isFinite(starts)) throw Error("Invalid Blaze start");
    if (
      starts <= Date.parse(c.capturedAt) ||
      state.status !== 0 ||
      state.match_status !== 0
    )
      continue;
    if (!Array.isArray(d.competitors) || d.competitors.length !== 2)
      throw Error("Invalid competitors");
    const teams = d.competitors.map((v) => id(object(v).name));
    const tournament = id(object(data.tournaments[id(d.tournament)]).name);
    result.push({
      provider: "blaze",
      esport,
      eventId,
      teamA: teams[0],
      teamB: teams[1],
      rawTeamA: teams[0],
      rawTeamB: teams[1],
      normalizedTeamA: teamName(teams[0], esport),
      normalizedTeamB: teamName(teams[1], esport),
      tournament,
      startsAt: new Date(starts).toISOString(),
      status: "scheduled",
      inPlay: false,
      suspended: null,
      fetchedAt: c.capturedAt,
      markets: markets(e.markets, data.descriptions, teams, at),
      provenance: {
        source: c.source,
        rawTournament: tournament,
        desc: d,
        state,
        manifestVersion: object(c.data.manifest).version,
      },
    });
  }
  return result.sort(
    (a, b) =>
      a.startsAt.localeCompare(b.startsAt) ||
      a.eventId.localeCompare(b.eventId),
  );
}
export function parseDetail(
  c: BlazeCapture,
  esport: Esport,
  eventId: string,
): NormalizedEvent {
  const event = parseListing(c, esport).find((e) => e.eventId === eventId);
  if (event) return event;
  const entry = merged(c).events.get(eventId);
  if (
    entry &&
    Number(object(entry.value.desc).scheduled) * 1000 <=
      Date.parse(c.capturedAt)
  )
    throw new EventStartedError();
  throw Error("Blaze event absent from complete prematch snapshot");
}
