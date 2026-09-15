import type { Esport } from "../../../shared/types/common.js";
import {
  SPORTS,
  object,
  type BlazeCapture,
  type ObjectValue,
} from "../types/feed.js";
/** Archive only the requested sport after validating the complete wire snapshot. */
export function projectCapture(c: BlazeCapture, esport: Esport): BlazeCapture {
  const tournaments = new Set<string>(),
    marketIds = new Set<string>();
  const shards = c.data.shards.map((s) => {
    const d = object(s.data),
      events = Object.fromEntries(
        Object.entries(object(d.events)).filter(
          ([, e]) => object(object(e).desc).sport === SPORTS[esport],
        ),
      );
    for (const e of Object.values(events)) {
      tournaments.add(String(object(object(e).desc).tournament));
      for (const k of Object.keys(object(object(e).markets))) marketIds.add(k);
    }
    return {
      version: s.version,
      data: {
        epoch: d.epoch,
        version: d.version,
        generated: d.generated,
        snapshot_complete: d.snapshot_complete,
        fixtures_complete: d.fixtures_complete,
        events,
        tournaments: object(d.tournaments ?? {}),
      } as ObjectValue,
    };
  });
  for (const s of shards)
    s.data.tournaments = Object.fromEntries(
      Object.entries(object(s.data.tournaments)).filter(([k]) =>
        tournaments.has(k),
      ),
    );
  const descriptions = Object.fromEntries(
    Object.entries(object(c.data.descriptions))
      .filter(([k]) => marketIds.has(k))
      .map(([k, v]) => {
        const d = object(v);
        return [
          k,
          {
            id: d.id,
            name: d.name,
            variants: d.variants,
            specifiers: d.specifiers ?? [],
            market_type: d.market_type ?? null,
          },
        ];
      }),
  );
  return {
    ...c,
    data: { ...c.data, projection: esport, shards, descriptions },
  };
}
