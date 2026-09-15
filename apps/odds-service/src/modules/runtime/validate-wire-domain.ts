import type { PersistencePublication } from "../../shared/interfaces/persistence-port.interface.js";
function object(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw Error("Unexpected domain field");
}
const text = (v: unknown) => {
  if (typeof v !== "string" || v.length > 4096) throw Error("Invalid text");
};
const timestamp = (v: unknown) => {
  if (
    typeof v !== "string" ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString() !== v
  )
    throw Error("Invalid timestamp");
};
const nullableNumber = (v: unknown) => {
  if (v !== null && (typeof v !== "number" || !Number.isFinite(v)))
    throw Error("Invalid number");
};
const flag = (v: unknown) => {
  if (v !== null && typeof v !== "boolean") throw Error("Invalid flag");
};
export function validateWireDomain(p: PersistencePublication) {
  timestamp(p.fetchedAt);
  const eventKeys = [
    "provider",
    "esport",
    "eventId",
    "teamA",
    "teamB",
    "markets",
    "inPlay",
    "suspended",
    "fetchedAt",
    "tournament",
    "startsAt",
    "status",
    "rawTeamA",
    "rawTeamB",
    "normalizedTeamA",
    "normalizedTeamB",
    "provenance",
  ];
  for (const e of [...p.events, ...p.observations.flatMap((b) => b.matches)]) {
    object(e, eventKeys);
    for (const v of [e.eventId, e.teamA, e.teamB]) text(v);
    if (e.provider !== p.provider || e.esport !== p.esport)
      throw Error("Mixed event identity");
    timestamp(e.fetchedAt);
    flag(e.inPlay);
    flag(e.suspended);
    if (!Array.isArray(e.markets)) throw Error("Invalid markets");
    for (const m of e.markets) {
      object(m, [
        "fetchedAt",
        "round",
        "period",
        "marketId",
        "rawMarketId",
        "category",
        "name",
        "groupId",
        "groupName",
        "map",
        "line",
        "suspended",
        "inPlay",
        "selections",
        "raw",
      ]);
      for (const v of [m.marketId, m.rawMarketId, m.category, m.name]) text(v);
      if (m.fetchedAt !== undefined) timestamp(m.fetchedAt);
      nullableNumber(m.line);
      nullableNumber(m.map);
      flag(m.suspended);
      flag(m.inPlay);
      if (m.map !== null && (!Number.isSafeInteger(m.map) || m.map < 1))
        throw Error("Invalid map");
      if (!Array.isArray(m.selections)) throw Error("Invalid selections");
      for (const s of m.selections) {
        object(s, [
          "columnName",
          "rowName",
          "selectionId",
          "name",
          "odds",
          "line",
          "side",
          "suspended",
          "inPlay",
          "raw",
        ]);
        text(s.selectionId);
        text(s.name);
        nullableNumber(s.odds);
        nullableNumber(s.line);
        flag(s.suspended);
        flag(s.inPlay);
        if (s.odds !== null && s.odds <= 1) throw Error("Invalid odds");
        if (s.side !== null && s.side !== "over" && s.side !== "under")
          throw Error("Invalid side");
      }
    }
  }
  for (const e of p.events) {
    for (const v of [
      e.tournament,
      e.rawTeamA,
      e.rawTeamB,
      e.normalizedTeamA,
      e.normalizedTeamB,
    ])
      text(v);
    timestamp(e.startsAt);
  }
  if (
    new Set(p.observations.map((b) => b.scope)).size !== p.observations.length
  )
    throw Error("Duplicate observation scope");
  for (const b of p.observations) {
    object(b.source, [
      "transport",
      "url",
      "method",
      "capture",
      "authenticated",
    ]);
    if (
      b.source.url !== "" ||
      b.source.method !== "GET" ||
      !["http", "xhr"].includes(b.source.transport) ||
      ![
        "chrome-devtools-copy-response",
        "playwright-response",
        "chrome-cdp-response",
        "direct-http",
      ].includes(b.source.capture)
    )
      throw Error("Invalid transport metadata");
    flag(b.source.authenticated);
    object(b, ["scope", "complete", "matches", "fetchedAt", "source"]);
    text(b.scope);
    timestamp(b.fetchedAt);
  }
}
