import { decimalOdds, label, records } from "./list.parser.js";
import { couponStructure } from "./protocol.parser.js";
import type { Capture, Match } from "../types/model.js";
import type {
  DetailedMatch,
  Market,
  RawFields,
  Selection,
} from "../../../shared/domain/market-model.js";
const numeric = (s: string | undefined) => s !== undefined && /^\d+$/.test(s);
const flag = (s: string | undefined): boolean | null =>
  s === "1" ? true : s === "0" ? false : null;
function inherited(...values: (boolean | null)[]): boolean | null {
  return values.includes(true)
    ? true
    : (values.find((v) => v !== null) ?? null);
}
const clean = (s: string | undefined) => label(s || "").trim();
export function lineValue(f: RawFields): number | null {
  const value = (f.HA || f.HD || "").replace(/^[OU]\s+/i, "").trim();
  if (!value) return null;
  return /^[+-]?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))
    ? Number(value)
    : null;
}
export function selectionSide(f: RawFields, name: string): Selection["side"] {
  if (/^O\s+[+-]?\d/i.test(f.HD || "") || /^(mais de|over)$/i.test(name))
    return "over";
  if (/^U\s+[+-]?\d/i.test(f.HD || "") || /^(menos de|under)$/i.test(name))
    return "under";
  return null;
}
export function category(
  name: string,
  group: string,
  map: number | null,
): string {
  const n = clean(name)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const g = clean(group)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  if (/impar.?par/.test(n))
    return /kills/.test(n) ? "kills_odd_even" : "odd_even";
  if (/pontuacao correta|resultado correto|correct score/.test(n))
    return "correct_score";
  if (/primeiro kill/.test(n)) return "first_kill";
  if (/kill.*handicap|handicap.*kill/.test(n)) return "kill_handicap";
  if (/total.*kills|kills.*total/.test(n)) return "total_kills";
  if (/total.*mapas|mapas.*total/.test(n)) return "total_maps";
  if (
    /rodadas?.*handicap|handicap.*rodadas?|rounds?.*handicap|handicap.*rounds?/.test(
      n,
    )
  )
    return /1º? tempo/.test(g) ? "first_half_round_handicap" : "round_handicap";
  if (/rodadas?.*total|total.*rodadas?|total.*rounds/.test(n))
    return "total_rounds";
  if (/handicap da partida|partida.*handicap/.test(n)) return "match_handicap";
  if (n.includes("/") && /vencedor/.test(n)) return "unknown";
  if (n === "para ganhar" || /vencedor do mapa|vencedor/.test(n)) {
    if (/rodada \d+/.test(g)) return "round_winner";
    if (/1º? tempo/.test(g))
      return /3 opcoes|empate/.test(n)
        ? "first_half_result"
        : "first_half_winner";
    return map === null ? "match_winner" : "map_winner";
  }
  return "unknown";
}
export interface DetailContext {
  match: Match;
  inPlay: boolean | null;
}
export interface DetailResult {
  match: DetailedMatch;
  tabs: { name: string; pd: string; selected: boolean }[];
  raw: ReturnType<typeof couponStructure>;
}
export function parseDetail(c: Capture, context: DetailContext): DetailResult {
  const u = new URL(c.source.url),
    pd = u.searchParams.get("pd");
  if (
    c.provider !== "bet365" ||
    c.esport !== context.match.esport ||
    u.origin !== "https://www.bet365.bet.br" ||
    u.pathname !== "/contentdata/othersportsmatchbettingcontentapi/coupon"
  )
    throw Error("Invalid detail source");
  if (
    [...u.searchParams.keys()].some(
      (k) => !["lid", "zid", "pd", "cid", "cgid", "ctid"].includes(k),
    )
  )
    throw Error("Unexpected detail query");
  if (!Number.isFinite(Date.parse(c.capturedAt)))
    throw Error("Invalid detail time");
  const raw = couponStructure(c.body),
    rr = raw.records,
    ev = rr.find((r) => r.type === "EV")?.fields;
  if (
    rr[0]?.type !== "CL" ||
    rr[0].fields.ID !== "151" ||
    rr[0].fields.IT !== pd ||
    ev?.FI !== context.match.eventId
  )
    throw Error("Detail scope/event mismatch");
  const eventId = ev.FI,
    evInPlay = flag(ev.IB) ?? context.inPlay,
    eventSuspended = flag(ev.SU);
  const tabs = raw.groups
    .filter((g) => g.fields.SY === "cm")
    .flatMap((g) =>
      g.markets
        .filter((m) => m.fields.PD)
        .map((m) => ({
          name: clean(m.fields.NA),
          pd: m.fields.PD,
          selected: m.fields.LS === "1",
        })),
    );
  const tabMap = /\bmapa?\s+(\d+)\b/i.exec(
    tabs.find((t) => t.selected)?.name || "",
  )?.[1];
  const markets = new Map<string, Market>();
  let expectedSelections = 0,
    actualSelections = 0;
  for (const group of raw.groups) {
    const g = group.fields;
    if (g.SY === "cm") continue;
    const headers = group.markets.flatMap((m) =>
      m.selections.filter((p) => p.ID?.startsWith("PC")),
    );
    const headerById = new Map(
      headers.map((p) => [p.ID.slice(2), clean(p.NA)]),
    );
    const rowMode = group.markets.some((m) =>
      m.selections.some((p) => numeric(p.ID) && numeric(p.MA)),
    );
    const titles = new Map<string, string>();
    if (rowMode)
      for (const m of group.markets)
        for (const p of m.selections) {
          if (numeric(p.ID) && p.MA && headerById.has(p.ID))
            titles.set(p.MA, headerById.get(p.ID)!);
        }
    for (const column of group.markets) {
      const cf = column.fields;
      const real = column.selections.filter((p) => numeric(p.ID));
      expectedSelections += real.length;
      if (
        real.length &&
        ["_f", "dl"].includes(cf.PY) &&
        numeric(cf.CN) &&
        real.length !== Number(cf.CN)
      )
        throw Error("Incomplete selection column");
      if (
        rowMode &&
        real.length &&
        headers.length &&
        real.length !== headers.length
      )
        throw Error("Incomplete market rows");
      for (const [row, p] of real.entries()) {
        if ((p.FI && p.FI !== eventId) || (cf.FI && cf.FI !== eventId))
          throw Error("Foreign event selection in coupon");
        const rawMarketId =
          p.MA || cf.MA || (/^M\d+$/.test(cf.ID || "") ? cf.ID.slice(1) : g.ID);
        if (!rawMarketId) throw Error("Selection missing market identity");
        const marketId = `${eventId}:${rawMarketId}`,
          groupName = clean(g.NA),
          name = rowMode
            ? titles.get(rawMarketId) || groupName
            : groupName || clean(cf.NA) || rawMarketId;
        const mapMatch =
          /\bmapa?\s+(\d+)\b/i.exec(groupName) ||
          /\bmapa?\s+(\d+)\b/i.exec(name);
        const map = mapMatch
          ? Number(mapMatch[1])
          : tabMap
            ? Number(tabMap)
            : null;
        const columnName = clean(cf.NA),
          rowName = rowMode
            ? ""
            : headerById.get(p.ID) || clean(headers[row]?.NA);
        let selectionName =
          clean(p.NA) ||
          [columnName, rowName].filter(Boolean).join(" ") ||
          p.ID;
        const side = selectionSide(p, selectionName);
        if (/^[OU]\s+/i.test(p.HD || ""))
          selectionName = side === "over" ? "Mais de" : "Menos de";
        const suspended = inherited(
          flag(p.SU),
          flag(cf.SU),
          flag(g.SU),
          eventSuspended,
        );
        const odds = p.OD ? decimalOdds(p.OD) : null;
        if (odds === null && suspended !== true)
          throw Error("Missing odds on a non-suspended selection");
        const selection: Selection = {
          selectionId: p.ID,
          name: selectionName,
          odds,
          line: lineValue(p),
          side,
          suspended,
          inPlay: flag(p.IB) ?? flag(cf.IB) ?? flag(g.IB) ?? evInPlay,
          raw: p,
          columnName: columnName || null,
          rowName: rowName || null,
        };
        let market = markets.get(marketId);
        if (!market) {
          market = {
            marketId,
            rawMarketId,
            category: category(name, groupName, map),
            name,
            groupId: g.ID || null,
            groupName: groupName || null,
            map,
            line: null,
            suspended: null,
            inPlay: flag(cf.IB) ?? flag(g.IB) ?? evInPlay,
            selections: [],
            raw: g,
            fetchedAt: c.capturedAt,
            round: Number(/\brodada\s+(\d+)\b/i.exec(groupName)?.[1]) || null,
            period: /1[ºo]?\s*tempo/i.test(groupName) ? "first_half" : null,
          };
          markets.set(marketId, market);
        } else if (market.map !== map || market.name !== name)
          throw Error(
            "Conflicting market identity; preserve raw coupon for investigation",
          );
        const previous = market.selections.find((s) => s.selectionId === p.ID);
        if (previous && JSON.stringify(previous) !== JSON.stringify(selection))
          throw Error("Conflicting duplicate selection");
        if (!previous) market.selections.push(selection);
        actualSelections++;
      }
    }
  }
  if (!markets.size || actualSelections !== expectedSelections)
    throw Error("Incomplete detail coupon");
  for (const m of markets.values()) {
    if (
      ["match_winner", "map_winner"].includes(m.category) &&
      m.selections.length !== 2
    )
      throw Error("Incomplete winner market");
    const states = m.selections.map((s) => s.suspended);
    m.suspended = states.every((s) => s === true)
      ? true
      : states.every((s) => s === false)
        ? false
        : null;
    const lines = m.selections.map((s) => s.line);
    m.line =
      lines.length && lines[0] !== null && lines.every((l) => l === lines[0])
        ? lines[0]
        : null;
  }
  return {
    match: {
      provider: "bet365",
      esport: c.esport,
      eventId,
      teamA: context.match.teamA,
      teamB: context.match.teamB,
      markets: [...markets.values()],
      inPlay: evInPlay,
      suspended: eventSuspended,
      fetchedAt: c.capturedAt,
    },
    tabs,
    raw,
  };
}
