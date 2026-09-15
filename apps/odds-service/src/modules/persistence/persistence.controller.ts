import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { OddsReadRepository } from "./repositories/read.repository.js";
import { DataIssuesRepository } from "./repositories/issues.repository.js";
import { ServiceError } from "../../shared/errors/domain-errors.js";
import { displayOdds } from "../../shared/utils/odds-display.js";
type ReadEvent = Awaited<ReturnType<OddsReadRepository["events"]>>[number];
function presentReadEvent(event: ReadEvent) {
  return {
    ...event,
    matches: event.matches.map((match) => ({
      ...match,
      providerEvent: {
        ...match.providerEvent,
        markets: match.providerEvent.markets.map((market) => ({
          ...market,
          selections: market.selections.map((selection) => ({
            ...selection,
            snapshots: selection.snapshots.map((snapshot) => {
              const odds = snapshot.odds == null ? null : Number(snapshot.odds);
              return { ...snapshot, odds, displayOdds: displayOdds(odds) };
            }),
          })),
        })),
      },
    })),
  };
}
const uuid = (v: string) => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  )
    throw new ServiceError("Invalid UUID", 400);
  return v;
};
@Controller()
export class PersistenceController {
  constructor(
    @Inject(OddsReadRepository) private readonly read: OddsReadRepository,
    @Inject(DataIssuesRepository) private readonly issues: DataIssuesRepository,
  ) {}
  @Get("providers") providers() {
    return this.read.providers();
  }
  @Get("events") async events() {
    return (await this.read.events()).map(presentReadEvent);
  }
  @Get("events/:id") async event(@Param("id") id: string) {
    const [e] = await this.read.events(uuid(id));
    if (!e) throw new ServiceError("Event not found", 404);
    return presentReadEvent(e);
  }
  @Get("issues") listIssues(@Query("status") status = "open") {
    if (!["open", "resolved", "ignored"].includes(status))
      throw new ServiceError("Invalid issue status", 400);
    return this.issues.list(status as "open" | "resolved" | "ignored");
  }
  @Get("provider-events") providerEvents(@Query("provider") provider?: string) {
    return this.read.providerEvents(provider);
  }
  @Get("selections/:id/odds-history") async history(
    @Param("id") id: string,
    @Query("before") before?: string,
  ) {
    if (before && !Number.isFinite(Date.parse(before)))
      throw new ServiceError("Invalid before timestamp", 400);
    return (
      await this.read.history(uuid(id), before ? new Date(before) : undefined)
    ).map((snapshot) => {
      const odds = snapshot.odds == null ? null : Number(snapshot.odds);
      return { ...snapshot, odds, displayOdds: displayOdds(odds) };
    });
  }
}
