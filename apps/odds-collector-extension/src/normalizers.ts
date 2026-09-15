import { parseCapture } from "../../odds-service/src/modules/bet365/parsers/list.parser.js";
import { normalizedBet365 } from "../../odds-service/src/modules/bet365/mappers/bet365.mapper.js";
import {
  parseListing as parseBetano,
  parseDetail as detailBetano,
} from "../../odds-service/src/modules/betano/parsers/feed.parser.js";
import {
  parseListing as parseSuperbet,
  parseDetail as detailSuperbet,
} from "../../odds-service/src/modules/superbet/parsers/feed.parser.js";
import {
  parseListing as parseBlaze,
  parseDetail as detailBlaze,
} from "../../odds-service/src/modules/blaze/parsers/feed.parser.js";
import {
  parseListing as parseEstrelaBet,
  parseDetail as detailEstrelaBet,
} from "../../odds-service/src/modules/estrelabet/parsers/feed.parser.js";
import type { Capture as Bet365Capture } from "../../odds-service/src/modules/bet365/types/model.js";
import type { BetanoCapture } from "../../odds-service/src/modules/betano/parsers/feed.parser.js";
import type { SuperbetCapture } from "../../odds-service/src/modules/superbet/types/feed.js";
import type { BlazeCapture } from "../../odds-service/src/modules/blaze/types/feed.js";
import type { EstrelaBetCapture } from "../../odds-service/src/modules/estrelabet/types/feed.js";
import type { Esport } from "../../odds-service/src/shared/types/common.js";

export function normalizeBet365(capture: Bet365Capture) {
  const parsed = parseCapture(capture);
  return normalizedBet365(parsed.matches, parsed.provenance);
}

export function normalizeBetano(capture: BetanoCapture, esport: Esport) {
  return parseBetano(capture, esport);
}

export function normalizeBetanoDetail(
  capture: BetanoCapture,
  esport: Esport,
  eventId: string,
) {
  return detailBetano(capture, esport, eventId);
}

export function normalizeSuperbet(
  capture: SuperbetCapture,
  esport: Esport,
  structure: SuperbetCapture,
) {
  return parseSuperbet(capture, esport, structure);
}

export function normalizeSuperbetDetail(
  capture: SuperbetCapture,
  esport: Esport,
  eventId: string,
  structure: SuperbetCapture,
) {
  return detailSuperbet(capture, esport, eventId, structure);
}

export function normalizeBlaze(capture: BlazeCapture, esport: Esport) {
  return parseBlaze(capture, esport);
}

export function normalizeBlazeDetail(
  capture: BlazeCapture,
  esport: Esport,
  eventId: string,
) {
  return detailBlaze(capture, esport, eventId);
}

export function normalizeEstrelaBet(
  capture: EstrelaBetCapture,
  esport: Esport,
) {
  return parseEstrelaBet(capture, esport);
}

export function normalizeEstrelaBetDetail(
  capture: EstrelaBetCapture,
  esport: Esport,
  eventId: string,
) {
  return detailEstrelaBet(capture, esport, eventId);
}
