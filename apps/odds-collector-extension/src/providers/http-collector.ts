import {
  superbetStructure,
  superbetList,
  blazeSnapshot,
  estrelaSnapshot,
  superbetDetail,
  estrelaDetail,
} from "./http.js";
import {
  normalizeSuperbet,
  normalizeBlaze,
  normalizeEstrelaBet,
  normalizeSuperbetDetail,
  normalizeBlazeDetail,
  normalizeEstrelaBetDetail,
} from "../normalizers.js";
import { httpPublication, type HttpProvider } from "../publication.js";
import { queue, flush } from "../publisher.js";
import type { Esport } from "../../../odds-service/src/shared/types/common.js";

const esports: Esport[] = ["cs2", "lol", "valorant"];

export async function collectHttp(provider: HttpProvider) {
  const signal = AbortSignal.timeout(180000);
  const publications = [];
  if (provider === "superbet") {
    const structure = await superbetStructure(signal);
    for (const esport of esports) {
      const capture = await superbetList(esport, signal);
      const events = normalizeSuperbet(capture, esport, structure);
      publications.push(
        httpPublication(
          provider,
          esport,
          "list",
          capture.capturedAt,
          capture.source,
          events,
        ),
      );
    }
  } else if (provider === "blaze") {
    const capture = await blazeSnapshot(signal);
    for (const esport of esports) {
      const events = normalizeBlaze(capture, esport);
      publications.push(
        httpPublication(
          provider,
          esport,
          "list",
          capture.capturedAt,
          capture.source,
          events,
        ),
      );
    }
  } else {
    const capture = await estrelaSnapshot(signal);
    for (const esport of esports) {
      const events = normalizeEstrelaBet(capture, esport);
      publications.push(
        httpPublication(
          provider,
          esport,
          "list",
          capture.capturedAt,
          capture.source,
          events,
        ),
      );
    }
  }
  for (const publication of publications) await queue(publication);
  await flush();
  return publications.flatMap((publication) => publication.events);
}

export async function collectHttpDetail(
  provider: HttpProvider,
  esport: Esport,
  eventId: string,
) {
  const signal = AbortSignal.timeout(180000);
  if (provider === "superbet") {
    const structure = await superbetStructure(signal);
    const capture = await superbetDetail(eventId, signal);
    const event = normalizeSuperbetDetail(capture, esport, eventId, structure);
    const publication = httpPublication(
      provider,
      esport,
      "detail",
      capture.capturedAt,
      capture.source,
      [event],
    );
    await queue(publication);
    await flush();
    return 1;
  }
  if (provider === "blaze") {
    const capture = await blazeSnapshot(signal);
    const event = normalizeBlazeDetail(capture, esport, eventId);
    const publication = httpPublication(
      provider,
      esport,
      "detail",
      capture.capturedAt,
      capture.source,
      [event],
    );
    await queue(publication);
    await flush();
    return 1;
  }
  const capture = await estrelaDetail(eventId, signal);
  const event = normalizeEstrelaBetDetail(capture, esport, eventId);
  const publication = httpPublication(
    provider,
    esport,
    "detail",
    capture.capturedAt,
    capture.source,
    [event],
  );
  await queue(publication);
  await flush();
  return 1;
}
