import {
  codes,
  type Capture,
  type Esport,
  type Parsed,
  type Match,
} from "../types/model.js";
export function records(
  body: string,
): { type: string; fields: Record<string, string> }[] {
  if (!body.startsWith("F|"))
    throw new Error(
      "Expected full F| feed; empty responses and deltas are not snapshots",
    );
  return body
    .slice(2)
    .split("|")
    .filter(Boolean)
    .map((row) => {
      const [type, ...parts] = row.split(";");
      if (!/^[A-Z]{2}$/.test(type)) throw new Error("Unknown record framing");
      const fields: Record<string, string> = {};
      for (const part of parts) {
        if (!part) continue;
        const i = part.indexOf("=");
        if (i < 1) throw new Error("Malformed field");
        fields[part.slice(0, i)] = part.slice(i + 1);
      }
      return { type, fields };
    });
}
function id(s: string | undefined): string {
  if (!s || !/^\d+$/.test(s)) throw new Error("Missing numeric provider ID");
  return s;
}
// The UI truncates recurring fractions (8/15 -> 1.53); retain three decimals below 1.10.
export function decimalOdds(raw: string): number {
  const m = /^(\d+)\/(\d+)$/.exec(raw);
  if (!m) throw new Error("Invalid fractional odds");
  const n = BigInt(m[1]),
    d = BigInt(m[2]);
  if (d === 0n || n === 0n)
    throw new Error("Invalid odds numerator/denominator");
  const scale = n * 10n < d ? 1000n : 100n;
  const value = Number(((n + d) * scale) / d) / Number(scale);
  if (!Number.isFinite(value) || value <= 1 || value > 1e9)
    throw new Error("Invalid numeric odds");
  return value;
}
// BC values match London wall time in the captured September fixtures, NOT UTC.
export function londonTime(raw: string): string {
  if (!/^\d{14}$/.test(raw)) throw new Error("Invalid BC timestamp");
  const parts = [
    +raw.slice(0, 4),
    +raw.slice(4, 6),
    +raw.slice(6, 8),
    +raw.slice(8, 10),
    +raw.slice(10, 12),
    +raw.slice(12, 14),
  ];
  const wall = Date.UTC(
    parts[0],
    parts[1] - 1,
    ...(parts.slice(2) as [number, number, number, number]),
  );
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const candidates = [wall, wall - 3600000].filter((t) => {
    const p = Object.fromEntries(
      fmt.formatToParts(t).map((p) => [p.type, p.value]),
    );
    return p.year + p.month + p.day + p.hour + p.minute + p.second === raw;
  });
  if (candidates.length !== 1)
    throw new Error("Invalid or ambiguous London timestamp");
  return new Date(candidates[0]).toISOString();
}
export function label(s: string): string {
  // DevTools Copy response exposed UTF-8 as Latin-1 in these fixtures. Repair only if reversible.
  if (!/[ÃÂ]/.test(s)) return s;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  const decoded = new TextDecoder("utf-8").decode(bytes);
  return decoded.includes("\uFFFD") ? s : decoded;
}
export function validateCapture(input: unknown): Capture {
  if (!input || typeof input !== "object")
    throw new Error("Capture object required");
  const c = input as Capture;
  if (
    c.provider !== "bet365" ||
    !Object.hasOwn(codes, c.esport) ||
    typeof c.body !== "string"
  )
    throw new Error("Invalid capture provider/esport/body");
  if (
    typeof c.capturedAt !== "string" ||
    !/^\d{4}-.*Z$/.test(c.capturedAt) ||
    !Number.isFinite(Date.parse(c.capturedAt))
  )
    throw new Error("Invalid capturedAt");
  if (
    !c.source ||
    c.source.transport !== "xhr" ||
    c.source.method !== "GET" ||
    ![
      "chrome-devtools-copy-response",
      "playwright-response",
      "chrome-cdp-response",
    ].includes(c.source.capture) ||
    (typeof c.source.authenticated !== "boolean" &&
      c.source.authenticated !== null)
  )
    throw new Error("Invalid provenance");
  const u = new URL(c.source.url);
  if (
    u.origin !== "https://www.bet365.bet.br" ||
    u.pathname !== "/contentdata/othersportsmatchmarketscontentapi/list"
  )
    throw new Error("Unvalidated endpoint");
  if (u.searchParams.get("pd") !== `#AC#B151#C1#D50#E${codes[c.esport]}#F163#`)
    throw new Error("Source/esport mismatch");
  if (
    [...u.searchParams.keys()].some(
      (k) => !["lid", "zid", "pd", "cid", "cgid", "ctid"].includes(k),
    )
  )
    throw new Error("Unexpected source query; do not persist tokens");
  return c;
}
export function parseCapture(input: unknown): Parsed {
  const c = validateCapture(input);
  const rr = records(c.body);
  if (
    rr[0]?.type !== "CL" ||
    rr[0].fields.ID !== "151" ||
    rr[0].fields.IT !== new URL(c.source.url).searchParams.get("pd")
  )
    throw new Error("Feed scope mismatch");
  const matches = new Map<string, Match>();
  const provenance: Parsed["provenance"] = {};
  const selectionMaps = new Map<
    string,
    Map<string, { selectionId: string; name: string; odds: number }>
  >();
  let tournament = "",
    column = "",
    market = "",
    groupSuspended = false;
  for (const { type, fields: f } of rr) {
    if (type === "MG") {
      tournament = label(f.NA || "");
      column = "";
      market = "";
      groupSuspended = f.SU === "1";
      const expected: Record<Esport, RegExp> = {
        cs2: /^CS2 - /,
        lol: /^LOL - /,
        valorant: /^VALORANT - /,
      };
      if (!expected[c.esport].test(tournament) || f.ID !== "1510001")
        throw new Error("Unvalidated game or market group");
    } else if (type === "MA") {
      column = f.NA;
      market = f.MA || f.ID?.replace(/^M/, "");
      if (f.SU === "1") groupSuspended = true;
    } else if (type === "PA" && f.ID?.startsWith("PC")) {
      const eventId = id(f.FI);
      id(f.ID.slice(2));
      if (
        !tournament ||
        !f.NA ||
        !f.N2 ||
        !["0", "1", "2"].includes(f.IB) ||
        !["0", "1"].includes(f.SU)
      )
        throw new Error("Incomplete match metadata");
      const competitionId = id(/#C(\d+)#/.exec(f.PD || "")?.[1]);
      const pageEventId = id(/#E(\d+)#/.exec(f.PD || "")?.[1]);
      const inPlay = f.IB === "1",
        // IB=2 occurs in the current prematch feed with future start and odds.
        // Its meaning is unconfirmed, so keep the observation but exclude it from matching.
        suspended = f.SU === "1" || groupSuspended || f.IB === "2";
      const match: Match = {
        provider: "bet365",
        esport: c.esport,
        eventId,
        tournament,
        teamA: label(f.NA),
        teamB: label(f.N2),
        startsAt: londonTime(f.BC),
        status: suspended ? "suspended" : inPlay ? "live" : "scheduled",
        markets: [],
        fetchedAt: c.capturedAt,
      };
      const old = matches.get(eventId);
      if (old && JSON.stringify(old) !== JSON.stringify(match))
        throw new Error("Conflicting duplicate event");
      matches.set(eventId, match);
      if (!selectionMaps.has(eventId)) selectionMaps.set(eventId, new Map());
      provenance[eventId] = {
        competitionId,
        pageEventId,
        rawMarketId: "1510001",
        inPlay,
        marketSuspended: suspended,
      };
    } else if (type === "PA" && f.OD !== undefined) {
      const eventId = id(f.FI),
        selectionId = id(f.ID);
      const match = matches.get(eventId);
      if (
        !match ||
        !["1", "2"].includes(column) ||
        market !== "1510001" ||
        !["0", "1"].includes(f.SU)
      )
        throw new Error("Unassociated selection or unsupported market");
      const selection = {
        selectionId,
        name: column === "1" ? match.teamA : match.teamB,
        odds: decimalOdds(f.OD),
      };
      const map = selectionMaps.get(eventId)!;
      const old = map.get(column);
      if (old && JSON.stringify(old) !== JSON.stringify(selection))
        throw new Error("Conflicting duplicate selection");
      map.set(column, selection);
      if (f.SU === "1" || groupSuspended) {
        match.status = "suspended";
        provenance[eventId].marketSuspended = true;
      }
    }
  }
  if (!matches.size)
    throw new Error(
      "No complete matches; do not infer disappearance from empty feed",
    );
  for (const [eventId, m] of matches) {
    const ss = selectionMaps.get(eventId)!;
    if (ss.size !== 2 || ss.get("1")!.selectionId === ss.get("2")!.selectionId)
      throw new Error("Missing/duplicate winner selections");
    m.markets = [
      {
        marketId: `${eventId}:1510001`,
        market: "match_winner",
        selections: [ss.get("1")!, ss.get("2")!],
      },
    ];
  }
  return {
    matches: [...matches.values()].sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) ||
        a.eventId.localeCompare(b.eventId),
    ),
    provenance,
  };
}
