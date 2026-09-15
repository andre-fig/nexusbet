export interface RetainedDomainCounts {
  events: number;
  markets: number;
  selections: number;
  rawBytes: number;
  approximateBytes: number;
}

export interface ProviderMemoryDiagnostics extends RetainedDomainCounts {
  snapshots: number;
  maps: Record<string, number>;
  structures: Record<string, unknown>;
}

export function approximateBytes(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return -1;
  }
}

export function retainedDomainCounts(
  matches: Iterable<{
    markets: Iterable<{
      raw?: unknown;
      selections: Iterable<{ raw?: unknown }>;
    }>;
  }>,
): RetainedDomainCounts {
  let events = 0,
    markets = 0,
    selections = 0,
    rawBytes = 0,
    totalApproximateBytes = 0;
  for (const event of matches) {
    events++;
    const eventBytes = approximateBytes(event);
    if (eventBytes >= 0) totalApproximateBytes += eventBytes;
    for (const market of event.markets) {
      markets++;
      const marketRawBytes = approximateBytes(market.raw);
      if (marketRawBytes >= 0) rawBytes += marketRawBytes;
      for (const selection of market.selections) {
        selections++;
        const selectionRawBytes = approximateBytes(selection.raw);
        if (selectionRawBytes >= 0) rawBytes += selectionRawBytes;
      }
    }
  }
  return {
    events,
    markets,
    selections,
    rawBytes,
    approximateBytes: totalApproximateBytes,
  };
}

export function combineDomainCounts(
  counts: RetainedDomainCounts[],
): RetainedDomainCounts {
  return counts.reduce(
    (total, value) => ({
      events: total.events + value.events,
      markets: total.markets + value.markets,
      selections: total.selections + value.selections,
      rawBytes: total.rawBytes + value.rawBytes,
      approximateBytes: total.approximateBytes + value.approximateBytes,
    }),
    { events: 0, markets: 0, selections: 0, rawBytes: 0, approximateBytes: 0 },
  );
}
