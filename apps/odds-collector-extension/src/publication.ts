import { validatePublication } from "../../odds-service/src/shared/domain/validate-publication.js";
import { validateWireDomain } from "../../odds-service/src/modules/runtime/validate-wire-domain.js";
import type { NormalizedEvent } from "../../odds-service/src/shared/domain/normalized-event.js";
import type { PersistencePublication } from "../../odds-service/src/shared/interfaces/persistence-port.interface.js";
import type { Source } from "../../odds-service/src/shared/types/common.js";
import { parseCapture } from "../../odds-service/src/modules/bet365/parsers/list.parser.js";
import { normalizedBet365 } from "../../odds-service/src/modules/bet365/mappers/bet365.mapper.js";
import { listMarkets } from "../../odds-service/src/modules/bet365/mappers/list.mapper.js";
import type { Capture as Bet365Capture } from "../../odds-service/src/modules/bet365/types/model.js";
import {
  normalizeRound,
  type DetailRound,
} from "../../odds-service/src/modules/bet365/persistence/detail-round.js";
import {
  normalizeListingRound,
  type ListingRound as BetanoListingRound,
} from "../../odds-service/src/modules/betano/persistence/listing-round.js";
import { parseDetail as parseBetanoDetail } from "../../odds-service/src/modules/betano/parsers/feed.parser.js";
import type { BetanoCapture } from "../../odds-service/src/modules/betano/parsers/feed.parser.js";

export type HttpProvider = "superbet" | "blaze" | "estrelabet";

export function bet365Publication(
  capture: Bet365Capture,
): PersistencePublication {
  const parsed = parseCapture(capture);
  const events = normalizedBet365(parsed.matches, parsed.provenance);
  if (!events.length) throw Error("Empty Bet365 feed is not a publication");
  const scope = `bet365:list:${capture.esport}`;
  const publication: PersistencePublication = {
    provider: "bet365",
    esport: capture.esport,
    kind: "list",
    scope,
    fetchedAt: capture.capturedAt,
    events,
    observations: [
      {
        scope,
        complete: true,
        matches: listMarkets(parsed),
        fetchedAt: capture.capturedAt,
        source: capture.source,
      },
    ],
    checkpoint: { key: `extension:${scope}`, payload: null },
  };
  validatePublication(publication);
  return publication;
}

export function bet365DetailPublication(
  round: DetailRound,
): PersistencePublication {
  const result = normalizeRound(round);
  const listing = parseCapture(round.listing);
  const base = normalizedBet365(listing.matches, listing.provenance).find(
    (event) => event.eventId === round.eventId,
  );
  if (!base) throw Error("Bet365 detail absent from accepted listing");
  const scope = `bet365:detail:${round.eventId}:${round.coverage}`;
  const publication: PersistencePublication = {
    provider: "bet365",
    esport: result.match.esport,
    kind: "detail",
    scope,
    fetchedAt: result.match.fetchedAt,
    events: [{ ...base, ...result.match }],
    observations: result.parts.map((part, index) => ({
      scope: `detail:${part.match.esport}:${part.match.eventId}:${result.routes[index]}`,
      complete: true,
      matches: [part.match],
      fetchedAt: part.match.fetchedAt,
      source: round.captures[index].source,
    })),
    checkpoint: { key: `extension:${scope}`, payload: null },
  };
  validatePublication(publication);
  return publication;
}

export function betanoPublication(
  round: BetanoListingRound,
): PersistencePublication {
  const normalized = normalizeListingRound(round);
  if (!normalized.matches.length)
    throw Error("Empty Betano round is not a publication");
  const publication: PersistencePublication = {
    provider: "betano",
    esport: round.esport,
    kind: "list",
    scope: normalized.scope,
    fetchedAt: normalized.at,
    events: normalized.matches,
    observations: [
      {
        scope: normalized.scope,
        complete: true,
        fetchedAt: normalized.at,
        source: normalized.source,
        matches: normalized.matches.map((event) => ({
          ...event,
          fetchedAt: normalized.at,
        })),
      },
    ],
    checkpoint: { key: `extension:${normalized.scope}`, payload: null },
  };
  validatePublication(publication);
  return publication;
}

export function betanoDetailPublication(
  capture: BetanoCapture,
  esport: "cs2" | "lol" | "valorant",
  eventId: string,
): PersistencePublication {
  const event = parseBetanoDetail(capture, esport, eventId);
  const selected = capture.data.markets?.find(
    (tab: { selected?: boolean }) => tab.selected,
  )?.type;
  if (selected !== "popular") throw Error("Unexpected Betano detail scope");
  const scope = `betano:detail:${eventId}:popular`;
  const publication: PersistencePublication = {
    provider: "betano",
    esport,
    kind: "detail",
    scope,
    fetchedAt: event.fetchedAt,
    events: [event],
    observations: [
      {
        scope,
        complete: true,
        matches: [event],
        fetchedAt: event.fetchedAt,
        source: capture.source,
      },
    ],
    checkpoint: { key: `extension:${scope}`, payload: null },
  };
  validatePublication(publication);
  return publication;
}

export function httpPublication(
  provider: HttpProvider,
  esport: "cs2" | "lol" | "valorant",
  kind: "list" | "detail",
  fetchedAt: string,
  source: Source,
  events: NormalizedEvent[],
): PersistencePublication {
  if (!events.length) throw Error("Empty normalized feed is not a publication");
  const suffix = provider === "superbet" ? "180d" : "prematch";
  const scope =
    kind === "list"
      ? `${provider}:list:${esport}:${suffix}`
      : `${provider}:detail:${events[0].eventId}:prematch`;
  const publication: PersistencePublication = {
    provider,
    esport,
    kind,
    scope,
    fetchedAt,
    events,
    observations: [
      { scope, complete: true, matches: events, fetchedAt, source },
    ],
    checkpoint: { key: `extension:${provider}:${scope}`, payload: null },
  };
  validatePublication(publication);
  return publication;
}

export function toWire(publication: PersistencePublication) {
  validatePublication(publication);
  const { checkpoint: _checkpoint, ...domain } = publication;
  const clean = JSON.parse(
    JSON.stringify(domain, (key, value: unknown) =>
      ["raw", "provenance"].includes(key)
        ? {}
        : key === "source"
          ? {
              transport: (value as Source).transport,
              url: "",
              method: "GET",
              capture: (value as Source).capture,
              authenticated: (value as Source).authenticated,
            }
          : value,
    ),
  );
  const payload = {
    ...clean,
    collectionRunId: crypto.randomUUID(),
    collectedAt: publication.fetchedAt,
  };
  validateWireDomain({ ...publication, ...payload });
  return payload;
}
