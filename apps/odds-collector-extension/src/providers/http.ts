import {
  OFFER_ORIGIN as SUPERBET_ORIGIN,
  SPORTS as SUPERBET_SPORTS,
  type SuperbetCapture,
} from "../../../odds-service/src/modules/superbet/types/feed.js";
import {
  OFFER_ORIGIN as BLAZE_ORIGIN,
  PREMATCH_PATH,
  DESCRIPTIONS_PATH,
  object as blazeObject,
  type BlazeCapture,
} from "../../../odds-service/src/modules/blaze/types/feed.js";
import {
  API_BASE,
  COMMON_QUERY,
  object as estrelaObject,
  type EstrelaBetCapture,
} from "../../../odds-service/src/modules/estrelabet/types/feed.js";
import type { Esport } from "../../../odds-service/src/shared/types/common.js";

async function json(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    signal,
  });
  if (!response.ok) throw Error(`Feed HTTP ${response.status}`);
  return response.json();
}

function source(url: string) {
  return {
    transport: "http" as const,
    method: "GET" as const,
    url,
    capture: "direct-http" as const,
    authenticated: false,
  };
}

export async function superbetStructure(
  signal?: AbortSignal,
): Promise<SuperbetCapture> {
  const url = SUPERBET_ORIGIN + "/v2/pt-BR/struct";
  const data = await json(url, signal);
  return {
    provider: "superbet",
    capturedAt: new Date().toISOString(),
    status: 200,
    source: source(url),
    data,
  };
}

export async function superbetList(
  esport: Esport,
  signal?: AbortSignal,
): Promise<SuperbetCapture> {
  const now = Math.floor(Date.now() / 3600000) * 3600000;
  const query = new URLSearchParams({
    startDate: new Date(now).toISOString(),
    endDate: new Date(now + 180 * 86400000).toISOString(),
    index: "active-prematch",
    sports: String(SUPERBET_SPORTS[esport]),
  });
  const url = SUPERBET_ORIGIN + "/v3/pt-BR/events?" + query;
  const data = await json(url, signal);
  return {
    provider: "superbet",
    capturedAt: new Date().toISOString(),
    status: 200,
    source: source(url),
    data,
  };
}

export async function superbetDetail(
  id: string,
  signal?: AbortSignal,
): Promise<SuperbetCapture> {
  if (!/^\d+$/.test(id)) throw Error("Invalid Superbet event ID");
  const url = SUPERBET_ORIGIN + "/v2/pt-BR/events/" + id;
  const data = await json(url, signal);
  return {
    provider: "superbet",
    capturedAt: new Date().toISOString(),
    status: 200,
    source: source(url),
    data,
  };
}

export async function blazeSnapshot(
  signal?: AbortSignal,
): Promise<BlazeCapture> {
  const url = BLAZE_ORIGIN + PREMATCH_PATH + "0";
  const manifest = blazeObject(await json(url, signal));
  if (
    !Array.isArray(manifest.top_events_versions) ||
    !Array.isArray(manifest.rest_events_versions)
  )
    throw Error("Missing Blaze snapshot manifest");
  const versions = [
    ...manifest.top_events_versions,
    ...manifest.rest_events_versions,
  ];
  if (
    !versions.length ||
    versions.length > 100 ||
    versions.some((v) => !Number.isSafeInteger(v) || v <= 0) ||
    new Set(versions).size !== versions.length
  )
    throw Error("Invalid Blaze snapshot versions");
  const shards = [];
  for (const version of versions)
    shards.push({
      version,
      data: await json(BLAZE_ORIGIN + PREMATCH_PATH + version, signal),
    });
  const descriptions = await json(BLAZE_ORIGIN + DESCRIPTIONS_PATH, signal);
  return {
    provider: "blaze",
    capturedAt: new Date().toISOString(),
    status: 200,
    source: source(url),
    data: { manifest, shards, descriptions },
  };
}

export async function estrelaSnapshot(
  signal?: AbortSignal,
): Promise<EstrelaBetCapture> {
  const path = `GetUpcoming?${COMMON_QUERY}&sportId=145&eventCount=20`;
  const url = API_BASE + path;
  const first = estrelaObject(await json(url, signal));
  const count = first.pageCount;
  if (
    !Number.isSafeInteger(count) ||
    Number(count) < 1 ||
    Number(count) > 100 ||
    first.page !== 1
  )
    throw Error("Invalid EstrelaBet pagination");
  const pages = [first];
  for (let page = 2; page <= Number(count); page++) {
    const next = estrelaObject(await json(url + "&page=" + page, signal));
    if (next.page !== page || next.pageCount !== count)
      throw Error("EstrelaBet pagination changed; incomplete round");
    pages.push(next);
  }
  return {
    provider: "estrelabet",
    capturedAt: new Date().toISOString(),
    status: 200,
    source: source(url),
    data: { pages },
  };
}

export async function estrelaDetail(
  id: string,
  signal?: AbortSignal,
): Promise<EstrelaBetCapture> {
  if (!/^\d+$/.test(id)) throw Error("Invalid EstrelaBet event ID");
  const url =
    API_BASE +
    `GetEventDetails?${COMMON_QUERY}&eventId=${encodeURIComponent(id)}&showNonBoosts=false`;
  const detail = await json(url, signal);
  return {
    provider: "estrelabet",
    capturedAt: new Date().toISOString(),
    status: 200,
    source: source(url),
    data: { detail },
  };
}
