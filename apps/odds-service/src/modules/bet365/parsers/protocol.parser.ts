import { records } from "./list.parser.js";
import type { RawFields } from "../../../shared/domain/market-model.js";
export interface ProtocolRecord {
  type: string;
  fields: RawFields;
}
export interface CouponMarket {
  fields: RawFields;
  records: ProtocolRecord[];
  selections: RawFields[];
}
export interface CouponGroup {
  fields: RawFields;
  records: ProtocolRecord[];
  markets: CouponMarket[];
}
// Lossless structural decoder. Semantic normalization must be validated against a captured coupon.
// A selection without OD is retained (including metadata and suspended selections).
export function couponStructure(body: string): {
  records: ProtocolRecord[];
  groups: CouponGroup[];
  unassociated: ProtocolRecord[];
} {
  const rr = records(body),
    groups: CouponGroup[] = [],
    unassociated: ProtocolRecord[] = [];
  let group: CouponGroup | undefined, market: CouponMarket | undefined;
  for (const r of rr) {
    if (r.type === "EV" || r.type === "CL") {
      group = undefined;
      market = undefined;
      unassociated.push(r);
    } else if (r.type === "MG") {
      group = { fields: r.fields, markets: [], records: [] };
      groups.push(group);
      market = undefined;
    } else if (r.type === "MA") {
      if (!group) {
        group = { fields: {}, markets: [], records: [] };
        groups.push(group);
      }
      market = { fields: r.fields, records: [], selections: [] };
      group.markets.push(market);
    } else if (r.type === "PA" && market) {
      market.selections.push(r.fields);
      market.records.push(r);
    } else if (market) market.records.push(r);
    else if (group) group.records.push(r);
    else unassociated.push(r);
  }
  return { records: rr, groups, unassociated };
}
