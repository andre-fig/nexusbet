import { validateWireDomain } from "./validate-wire-domain.js";
import { randomUUID } from "node:crypto";
import type { PersistencePublication } from "../../shared/interfaces/persistence-port.interface.js";
import { validatePublication } from "../../shared/domain/validate-publication.js";
import { providers } from "./runtime-settings.js";
export type WirePayload = Omit<PersistencePublication, "checkpoint"> & {
  collectionRunId: string;
  collectedAt: string;
};
// Raw, provenance and transport URLs are deliberately excluded from this protocol.
// Structured normalized domain fields retain original numeric precision and timestamps.
export function toWire(p: PersistencePublication): WirePayload {
  const { checkpoint: _checkpoint, ...domain } = p;
  const clean = JSON.parse(
    JSON.stringify(domain, (key, value: unknown) =>
      ["raw", "provenance"].includes(key)
        ? {}
        : key === "source"
          ? {
              transport: (value as { transport: unknown }).transport,
              url: "",
              method: "GET",
              capture: (value as { capture: unknown }).capture,
              authenticated: (value as { authenticated: unknown })
                .authenticated,
            }
          : value,
    ),
  ) as Omit<PersistencePublication, "checkpoint">;
  return { ...clean, collectionRunId: randomUUID(), collectedAt: p.fetchedAt };
}
export function fromWire(
  value: unknown,
  provider: string,
): PersistencePublication {
  if (!providers.includes(provider as (typeof providers)[number]))
    throw Error("Invalid provider");
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (k) =>
        ![
          "provider",
          "collectionRunId",
          "collectedAt",
          "esport",
          "kind",
          "scope",
          "fetchedAt",
          "events",
          "observations",
        ].includes(k),
    )
  )
    throw Error("Invalid payload");
  const p = value as WirePayload;
  if (
    p.provider !== provider ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      p.collectionRunId,
    ) ||
    p.collectedAt !== p.fetchedAt ||
    !["cs2", "lol", "valorant"].includes(p.esport) ||
    !["list", "detail"].includes(p.kind) ||
    typeof p.scope !== "string" ||
    p.scope.length > 512 ||
    !Array.isArray(p.events) ||
    !p.events.length ||
    !Array.isArray(p.observations)
  )
    throw Error("Invalid envelope");
  // Rebuild the envelope instead of accepting checkpoint keys or arbitrary top-level data.
  const result: PersistencePublication = {
    provider,
    collectionRunId: p.collectionRunId,
    esport: p.esport,
    kind: p.kind,
    scope: p.scope,
    fetchedAt: p.fetchedAt,
    events: p.events,
    observations: p.observations,
    checkpoint: {
      key: `ingestion:${provider}:${p.scope}`,
      payload: { events: p.events },
    },
  };
  validatePublication(result);
  validateWireDomain(result);
  for (const e of p.events) {
    if (
      typeof e.eventId !== "string" ||
      !e.teamA ||
      !e.teamB ||
      !["scheduled", "live", "suspended", "finished"].includes(e.status) ||
      !Number.isFinite(Date.parse(e.fetchedAt))
    )
      throw Error("Invalid event fields");
  }
  // Reject unknown/secret-bearing keys at every nesting level, including metadata.
  const check = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (/cookie|password|token|authorization|headers|storage|html/i.test(k))
        throw Error("Sensitive payload field");
      if (
        ["raw", "provenance"].includes(k) &&
        (!x || typeof x !== "object" || Object.keys(x).length)
      )
        throw Error("Raw metadata not supported by ingestion v1");
      check(x);
    }
  };
  check(value);
  return result;
}
