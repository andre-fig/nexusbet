import type { PersistencePublication } from "../interfaces/persistence-port.interface.js";
export function validatePublication(p: PersistencePublication) {
  if (
    !p.provider ||
    !p.scope ||
    !p.observations.length ||
    !Number.isFinite(Date.parse(p.fetchedAt))
  )
    throw Error("Invalid publication");
  const events = new Set<string>();
  for (const e of p.events) {
    if (
      e.provider !== p.provider ||
      e.esport !== p.esport ||
      !e.eventId ||
      events.has(e.eventId) ||
      !Number.isFinite(Date.parse(e.startsAt))
    )
      throw Error("Invalid event");
    events.add(e.eventId);
  }
  for (const b of p.observations) {
    if (!b.complete || !b.scope || !Number.isFinite(Date.parse(b.fetchedAt)))
      throw Error("Invalid observation scope");
    for (const e of b.matches) {
      if (!events.has(e.eventId) || e.provider !== p.provider)
        throw Error("Unexpected snapshot event");
      const markets = new Set<string>();
      for (const m of e.markets) {
        if (!m.marketId || markets.has(m.marketId))
          throw Error("Duplicate market");
        markets.add(m.marketId);
        const selections = new Set<string>();
        for (const s of m.selections) {
          if (
            !s.selectionId ||
            selections.has(s.selectionId) ||
            (s.odds !== null && (!Number.isFinite(s.odds) || s.odds <= 1))
          )
            throw Error("Invalid odds/selection");
          selections.add(s.selectionId);
        }
      }
    }
  }
}
