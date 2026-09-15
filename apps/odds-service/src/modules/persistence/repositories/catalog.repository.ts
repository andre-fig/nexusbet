import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "../../../generated/prisma/client.js";
import type { NormalizedEvent } from "../../../shared/domain/normalized-event.js";
import type { PersistencePublication } from "../../../shared/interfaces/persistence-port.interface.js";
import { tournamentName } from "../../../shared/utils/names.js";
import { snapshots } from "../../snapshots/market-journal.js";
import { sanitize } from "../sanitize.js";
import { DataIssuesRepository } from "./issues.repository.js";
import {
  incompleteMatchWinner,
  validSelectionCount,
} from "../../../shared/utils/market-quality.js";
@Injectable()
export class CatalogRepository {
  constructor(
    @Inject(DataIssuesRepository) private readonly issues: DataIssuesRepository,
  ) {}
  async write(
    tx: Prisma.TransactionClient,
    providerId: string,
    publicationId: string,
    p: PersistencePublication,
  ) {
    const selectionIds = new Map<string, string>();
    const key = (e: string, m: string, s: string) => JSON.stringify([e, m, s]);
    for (const e of p.events) {
      const at = new Date(e.fetchedAt);
      const data = {
        esport: e.esport,
        rawTeamA: e.rawTeamA,
        rawTeamB: e.rawTeamB,
        normalizedTeamA: e.normalizedTeamA,
        normalizedTeamB: e.normalizedTeamB,
        rawTournament: e.tournament,
        normalizedTournament: tournamentName(e.tournament, e.esport),
        startsAt: new Date(e.startsAt),
        providerStatus: e.status,
        inPlay: e.inPlay,
        suspended: e.suspended,
        lastSeenAt: at,
        fetchedAt: at,
        rawData: sanitize(e.provenance),
      };
      const existing = await tx.providerEvent.findUnique({
        where: {
          providerId_providerEventId: {
            providerId,
            providerEventId: e.eventId,
          },
        },
      });
      const row = await tx.providerEvent.upsert({
        where: {
          providerId_providerEventId: {
            providerId,
            providerEventId: e.eventId,
          },
        },
        create: {
          providerId,
          providerEventId: e.eventId,
          ...data,
          listed: p.kind === "list",
        },
        update: !existing || existing.fetchedAt <= at ? data : {},
      });
      if (p.kind === "list")
        await tx.providerEvent.update({
          where: { id: row.id },
          data: { listed: true, removedAt: null },
        });
      const observations = [
        ...p.observations.flatMap((b) =>
          b.matches
            .filter((x) => x.eventId === e.eventId)
            .map((x) => ({
              ...e,
              ...x,
              markets: x.markets.map((m) => ({
                ...m,
                fetchedAt: m.fetchedAt || x.fetchedAt,
              })),
            })),
        ),
        e,
      ];
      const latestMarkets = new Map<
        string,
        { market: NormalizedEvent["markets"][number]; at: Date }
      >();
      for (const observed of observations)
        for (const m of observed.markets) {
          const time = new Date(m.fetchedAt || observed.fetchedAt);
          const latest = latestMarkets.get(m.marketId);
          if (!latest || latest.at <= time)
            latestMarkets.set(m.marketId, { market: m, at: time });
          const md = {
            rawMarketId: m.rawMarketId,
            category: m.category,
            name: m.name,
            mapNumber: m.map,
            line: m.line,
            period: m.period ?? null,
            suspended: m.suspended,
            inPlay: m.inPlay,
            rawData: sanitize(m.raw),
            lastSeenAt: time,
          };
          let market = await tx.market.findUnique({
            where: {
              providerEventId_providerMarketId: {
                providerEventId: row.id,
                providerMarketId: m.marketId,
              },
            },
          });
          market = await tx.market.upsert({
            where: {
              providerEventId_providerMarketId: {
                providerEventId: row.id,
                providerMarketId: m.marketId,
              },
            },
            create: {
              providerEventId: row.id,
              providerMarketId: m.marketId,
              firstSeenAt: time,
              ...md,
            },
            update: !market || market.lastSeenAt <= time ? md : {},
          });
          for (const s of m.selections) {
            const sd = {
              name: s.name,
              side: s.side,
              line: s.line,
              suspended: s.suspended,
              rawData: sanitize(s.raw),
              fetchedAt: time,
            };
            const prior = await tx.selection.findUnique({
              where: {
                marketId_providerSelectionId: {
                  marketId: market.id,
                  providerSelectionId: s.selectionId,
                },
              },
            });
            const selection = await tx.selection.upsert({
              where: {
                marketId_providerSelectionId: {
                  marketId: market.id,
                  providerSelectionId: s.selectionId,
                },
              },
              create: {
                marketId: market.id,
                providerSelectionId: s.selectionId,
                ...sd,
              },
              update: !prior || prior.fetchedAt <= time ? sd : {},
            });
            selectionIds.set(
              key(e.eventId, m.marketId, s.selectionId),
              selection.id,
            );
          }
        }
      for (const [marketId, { market, at: time }] of latestMarkets) {
        const stored = await tx.market.findUniqueOrThrow({
          where: {
            providerEventId_providerMarketId: {
              providerEventId: row.id,
              providerMarketId: marketId,
            },
          },
        });
        if (stored.lastSeenAt > time) continue;
        const issueKey = `market_incomplete:${stored.id}`;
        if (incompleteMatchWinner(market, e.teamA, e.teamB))
          await this.issues.open(tx, {
            key: issueKey,
            type: "MARKET_INCOMPLETE",
            severity: "warning",
            message: `Expected 2 valid selections, found ${validSelectionCount(market)}`,
            providerId,
            providerEventId: row.id,
            marketId: stored.id,
            details: { marketId },
            at: time,
          });
        else await this.issues.transition(tx, issueKey, "resolved", time);
      }
    }
    const rows = p.observations.flatMap((b) =>
      snapshots(b.matches).map((s) => ({
        selectionId: selectionIds.get(
          key(s.eventId, s.marketId, s.selectionId),
        )!,
        publicationId,
        sourceScope: b.scope,
        odds: s.odds === null ? null : String(s.odds),
        line: s.line === null ? null : String(s.line),
        mapNumber: s.map,
        suspended: s.suspended,
        inPlay: s.inPlay,
        fetchedAt: new Date(s.fetchedAt),
      })),
    );
    if (rows.some((r) => !r.selectionId))
      throw Error("Unresolved snapshot selection");
    if (rows.length) await tx.oddsSnapshot.createMany({ data: rows });
  }
  async removed(
    tx: Prisma.TransactionClient,
    providerId: string,
    previous: NormalizedEvent[],
    events: NormalizedEvent[],
    at: Date,
  ) {
    const current = new Set(events.map((e) => e.eventId)),
      missing = previous
        .filter((e) => !current.has(e.eventId))
        .map((e) => e.eventId);
    if (missing.length)
      await tx.providerEvent.updateMany({
        where: {
          providerId,
          providerEventId: { in: missing },
          lastSeenAt: { lte: at },
        },
        data: { listed: false, removedAt: at },
      });
  }
}
