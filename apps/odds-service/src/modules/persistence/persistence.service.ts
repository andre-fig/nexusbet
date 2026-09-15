import { validatePublication } from "../../shared/domain/validate-publication.js";
export { validatePublication } from "../../shared/domain/validate-publication.js";
import { PersistenceNotifications } from "./persistence-notifications.js";
import { isDeepStrictEqual } from "node:util";
import { Injectable, Inject, Optional, OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { DatabaseService } from "../database/database.service.js";
import { seedProviders } from "../database/seed.js";
import { CatalogRepository } from "./repositories/catalog.repository.js";
import { MatchingRepository } from "./repositories/matching.repository.js";
import { sanitize } from "./sanitize.js";
import type {
  PersistencePort,
  PersistencePublication,
} from "../../shared/interfaces/persistence-port.interface.js";
import type { NormalizedEvent } from "../../shared/domain/normalized-event.js";
import type { MarketBatch } from "../../shared/domain/market-model.js";
import { marketChanges } from "../snapshots/market-journal.js";
import { ServiceError } from "../../shared/errors/domain-errors.js";
@Injectable()
export class PersistenceService implements PersistencePort, OnModuleInit {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogRepository) private readonly catalog: CatalogRepository,
    @Inject(MatchingRepository) private readonly matching: MatchingRepository,
    @Optional()
    @Inject(PersistenceNotifications)
    private readonly notifications?: PersistenceNotifications,
  ) {}
  get enabled() {
    return this.database.enabled;
  }
  async onModuleInit() {
    if (this.enabled) {
      if (!this.database.connected) await this.database.onModuleInit();
      await seedProviders(this.database.db);
    }
  }
  async restore<T>(key: string): Promise<T | undefined> {
    if (!this.enabled) return undefined;
    const row = await this.database.db.legacyCheckpoint.findUnique({
      where: { key },
    });
    return row?.payload as T | undefined;
  }
  async catalogEvents(): Promise<NormalizedEvent[]> {
    if (!this.enabled) return [];
    return (
      await this.database.db.feedScope.findMany({ where: { kind: "list" } })
    ).flatMap((s) => s.events as unknown as NormalizedEvent[]);
  }
  async detailEvents(): Promise<NormalizedEvent[]> {
    if (!this.enabled) return [];
    return (
      await this.database.db.feedScope.findMany({
        where: { kind: "detail" },
        orderBy: { fetchedAt: "asc" },
        select: { events: true },
      })
    ).flatMap((s) => s.events as unknown as NormalizedEvent[]);
  }
  equivalentObservation(a: MarketBatch, b: MarketBatch) {
    return isDeepStrictEqual(sanitize(a), sanitize(b));
  }
  async baselines(provider: NormalizedEvent["provider"]) {
    if (!this.enabled) return [];
    return latestBatches(
      (
        await this.database.db.feedScope.findMany({
          where: { provider: { slug: provider } },
          select: { observations: true },
        })
      ).flatMap((s) => s.observations as unknown as MarketBatch[]),
    );
  }
  async commit(
    input: PersistencePublication,
    afterCommit?: () => Promise<void> | void,
  ) {
    if (!this.enabled) {
      await afterCommit?.();
      return;
    }
    validatePublication(input);
    const p = sanitize(input) as unknown as PersistencePublication;
    const hash = createHash("sha256")
      .update(
        JSON.stringify({ events: p.events, observations: p.observations }),
      )
      .digest("hex");
    let notice;
    try {
      notice = await this.database.db.$transaction(
        async (tx) => {
          // One short publication lock makes matching + publication atomic across providers/processes.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(7140365)`;
          if (p.collectionRunId) {
            const receipt = await tx.ingestionRun.findUnique({
              where: {
                provider_collectionRunId: {
                  provider: p.provider,
                  collectionRunId: p.collectionRunId,
                },
              },
            });
            const runHash = createHash("sha256")
              .update(JSON.stringify(p))
              .digest("hex");
            if (receipt) {
              if (receipt.hash !== runHash)
                throw new ServiceError("Collection run conflict", 409);
              return;
            }
            await tx.ingestionRun.create({
              data: {
                provider: p.provider,
                collectionRunId: p.collectionRunId,
                hash: runHash,
              },
            });
          }
          const provider = await tx.provider.upsert({
            where: { slug: p.provider },
            create: { slug: p.provider, name: p.provider },
            update: {},
          });
          const scope = await tx.feedScope.upsert({
            where: { name: p.scope },
            create: {
              name: p.scope,
              providerId: provider.id,
              esport: p.esport,
              kind: p.kind,
              events: [],
              observations: [],
            },
            update: {},
          });
          if (
            scope.providerId !== provider.id ||
            scope.kind !== p.kind ||
            scope.esport !== p.esport
          )
            throw Error("Scope ownership mismatch");
          const at = new Date(p.fetchedAt);
          const prior = await tx.publication.findUnique({
            where: { scopeId_fetchedAt: { scopeId: scope.id, fetchedAt: at } },
          });
          if (prior) {
            if (prior.hash !== hash)
              throw Error("Conflicting observation at same time");
            return;
          }
          if (scope.fetchedAt && scope.fetchedAt > at) return;
          // A bookmaker round may expose the same journal scope through different coverage variants.
          // Compare against the latest observation of that scope, not just this publication envelope.
          const related = await tx.feedScope.findMany({
            where: {
              providerId: provider.id,
              OR: p.observations.map((b) => ({
                observations: { array_contains: [{ scope: b.scope }] },
              })),
            },
            select: { observations: true },
          });
          const old = latestBatches(
            related.flatMap((s) => s.observations as unknown as MarketBatch[]),
          );
          const accepted = p.observations.filter((b) => {
            const prior = old.find((x) => x.scope === b.scope);
            if (!prior || Date.parse(prior.fetchedAt) < Date.parse(b.fetchedAt))
              return true;
            if (
              Date.parse(prior.fetchedAt) === Date.parse(b.fetchedAt) &&
              !this.equivalentObservation(prior, b)
            )
              throw Error("Conflicting journal scope observation");
            return false;
          });
          const changes = accepted.flatMap((b) =>
            marketChanges(
              old.find((x) => x.scope === b.scope)?.matches ?? [],
              b.matches,
              b.fetchedAt,
              true,
            ),
          );
          const publication = await tx.publication.create({
            data: {
              scopeId: scope.id,
              fetchedAt: at,
              hash,
              changes: sanitize(changes),
            },
          });
          await this.catalog.write(tx, provider.id, publication.id, {
            ...p,
            observations: accepted,
          });
          if (p.kind === "list")
            await this.catalog.removed(
              tx,
              provider.id,
              scope.events as unknown as NormalizedEvent[],
              p.events,
              at,
            );
          await tx.feedScope.update({
            where: { id: scope.id },
            data: {
              events: sanitize(p.events),
              observations: sanitize(p.observations),
              fetchedAt: at,
            },
          });
          await this.matching.reconcile(
            tx,
            at,
            this.database.config.settings.ttlMs,
          );
          // Prisma's upsert RETURNING includes the entire checkpoint JSON,
          // although the publication does not use the returned row.
          const checkpointPayload = JSON.stringify(
            sanitize(p.checkpoint.payload),
          );
          const checkpointAt = new Date();
          await tx.$executeRaw(
            Prisma.sql`INSERT INTO legacy_checkpoints (key,payload,updated_at)
              VALUES (${p.checkpoint.key},${checkpointPayload}::jsonb,${checkpointAt})
              ON CONFLICT (key) DO UPDATE SET
                payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at`,
          );
          return {
            provider: p.provider,
            at: p.fetchedAt,
            changes,
            eventIds: p.events.map((e) => e.eventId),
          };
        },
        { maxWait: 30000, timeout: 120000 },
      );
    } catch (error) {
      if (error instanceof ServiceError && error.status === 409) throw error;
      this.database.operationFailed = true;
      throw new ServiceError(
        "PostgreSQL publication failed; last valid state retained",
        503,
      );
    }
    this.database.operationFailed = false;
    await afterCommit?.();
    if (notice) this.notifications?.committed.next(notice);
  }
}

function latestBatches(batches: MarketBatch[]): MarketBatch[] {
  const latest = new Map<string, MarketBatch>();
  for (const batch of batches) {
    const prior = latest.get(batch.scope);
    if (!prior || Date.parse(prior.fetchedAt) < Date.parse(batch.fetchedAt))
      latest.set(batch.scope, batch);
  }
  return [...latest.values()];
}
