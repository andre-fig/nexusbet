import { isTransportFailure } from "./collection-failure.js";
import type {
  ProviderRuntime,
  CollectOptions,
} from "../../shared/interfaces/odds-provider.interface.js";
import type { CollectionJob } from "./adaptive-scheduler.js";
import type { NormalizedEvent } from "../../shared/domain/normalized-event.js";
import { EventStartedError } from "./scheduling-policy.js";
/** Deferred direct publication is the commit point: late/partial results never reach a store. */
export async function scheduledOperation(
  provider: ProviderRuntime,
  job: CollectionJob,
  options: CollectOptions,
  signal: AbortSignal,
  beginCommit: () => void,
  coordinateCommit?: (
    publications: Array<() => Promise<void>>,
  ) => Promise<void>,
): Promise<NormalizedEvent[]> {
  const publications: Array<() => Promise<void>> = [];
  const args = { ...options, signal, publications };
  try {
    signal.throwIfAborted();
    const events =
      job.kind === "list"
        ? await provider.collectEvents(args)
        : [await provider.collectEventDetails(job.event, args)];
    signal.throwIfAborted();
    const ids = new Set<string>();
    for (const event of events) {
      if (
        event.provider !== provider.name ||
        ids.has(event.eventId) ||
        !options.esports.includes(event.esport) ||
        !Array.isArray(event.markets) ||
        !Number.isFinite(Date.parse(event.fetchedAt))
      )
        throw Error("Invalid normalized collection");
      ids.add(event.eventId);
    }
    if (job.kind === "detail") {
      const e = events[0];
      if (e.eventId !== job.event.eventId || e.esport !== job.event.esport)
        throw Error("Unexpected event detail");
      if (
        e.inPlay ||
        e.status === "live" ||
        Date.parse(e.startsAt) <= Date.now()
      )
        throw new EventStartedError();
    }
    if (coordinateCommit) await coordinateCommit(publications);
    else {
      beginCommit();
      // Do not abort a PostgreSQL transaction already begun. Shutdown drains this section.
      for (const publish of publications) await publish();
    }
    // Confirm that the provider-specific store accepted the committed publication.
    const accepted =
      job.kind === "list"
        ? provider.readEvents(options.esports)
        : [provider.readDetail(job.event.eventId, [job.event.esport])];
    for (const event of events) {
      const stored = accepted.find((e) => e.eventId === event.eventId);
      if (!stored || Date.parse(stored.fetchedAt) < Date.parse(event.fetchedAt))
        throw Error("Publication not accepted");
    }
    return events;
  } catch (error) {
    if (
      !(error instanceof EventStartedError) &&
      (job.kind === "list" || signal.aborted || isTransportFailure(error))
    )
      await provider.closeCollection();
    throw error;
  }
}
