import { LocalCdpService } from "../../shared/browser/local-cdp.service.js";
import {
  PERSISTENCE,
  type PersistencePort,
} from "../../shared/interfaces/persistence-port.interface.js";
import { AdaptiveScheduler, type CollectionJob } from "./adaptive-scheduler.js";
import { scheduledOperation } from "./scheduled-operation.js";
import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { setTimeout as delay } from "node:timers/promises";
import { ProviderRegistry } from "./provider-registry.js";
import { AppConfiguration } from "../../config/configuration.js";
import type { CollectOptions } from "../../shared/interfaces/odds-provider.interface.js";
import { IngestionCommitService } from "./ingestion-commit.service.js";
import type { ProviderRuntime } from "../../shared/interfaces/odds-provider.interface.js";
import type { Esport } from "../../shared/types/common.js";
import {
  ProviderUnavailableError,
  StaleDataError,
} from "../../shared/errors/domain-errors.js";
export interface CycleOptions extends CollectOptions {
  details?: boolean;
  retainClients?: boolean;
}
export interface CollectionResult {
  provider: string;
  status: "ok" | "partial" | "failed" | "busy";
  events: number;
  details: number;
  error?: string;
}
export interface ProviderRuntimeState {
  active: boolean;
  status: "active" | "disabled" | "unavailable";
  reason:
    | "active"
    | "disabled_by_config"
    | "disabled_in_runtime"
    | "transport_unavailable";
}
@Injectable()
export class CollectionService {
  private readonly logger = new Logger("Collection");
  private readonly active = new Set<string>();
  private readonly loops = new Set<string>();
  readonly scheduler: AdaptiveScheduler;
  constructor(
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
    @Inject(IngestionCommitService)
    private readonly ingestion: IngestionCommitService = new IngestionCommitService(),
    @Optional()
    @Inject(PERSISTENCE)
    private readonly persistence?: PersistencePort,
    @Optional()
    @Inject(LocalCdpService)
    private readonly localCdp?: LocalCdpService,
  ) {
    this.scheduler = new AdaptiveScheduler(
      config.settings.collection,
      registry.providers
        .filter((p) => this.providerRuntime(p.name).active)
        .map((p) => p.name),
      async (job, signal, commit) => {
        if (this.active.has(job.provider))
          throw Error("Provider already collecting");
        this.active.add(job.provider);
        const run = this.ingestion.begin(job.provider);
        try {
          return await scheduledOperation(
            registry.get(job.provider),
            job,
            { esports: config.settings.esports, existing: true },
            signal,
            commit,
            (publications) =>
              this.ingestion.commit(run, signal, commit, publications),
          );
        } finally {
          this.ingestion.finish(run);
          this.active.delete(job.provider);
        }
      },
      (entry) => this.logger.log(JSON.stringify(entry)),
    );
  }
  providerRuntime(name: string): ProviderRuntimeState {
    if (!this.registry.providers.some((provider) => provider.name === name))
      return {
        active: false,
        status: "disabled",
        reason: "disabled_in_runtime",
      };
    if (this.config.settings.runtime === "server")
      return { active: true, status: "active", reason: "active" };
    if (this.config.settings.collectProviders?.[name] === false)
      return {
        active: false,
        status: "disabled",
        reason: "disabled_by_config",
      };
    if (name === "estrelabet" && !this.config.settings.estrelabetEnabled)
      return {
        active: false,
        status: "disabled",
        reason: "disabled_by_config",
      };
    if (name === "blaze" && !this.config.settings.blazeEnabled)
      return {
        active: false,
        status: "disabled",
        reason: "disabled_by_config",
      };
    if (name !== "bet365" && name !== "betano")
      return { active: true, status: "active", reason: "active" };
    if (
      this.config.settings.browser.runtime !== "local-cdp" ||
      process.platform !== "darwin"
    )
      return {
        active: false,
        status: "disabled",
        reason: "disabled_in_runtime",
      };
    if (!this.config.settings.providerEnabled[name])
      return {
        active: false,
        status: "disabled",
        reason: "disabled_by_config",
      };
    if (!this.localCdp || this.localCdp.availability(name) === "unavailable")
      return {
        active: true,
        status: "unavailable",
        reason: "transport_unavailable",
      };
    return { active: true, status: "active", reason: "active" };
  }
  activeProviderNames() {
    return this.registry.providers
      .map((provider) => provider.name)
      .filter((name) => this.providerRuntime(name).active);
  }
  matchingEligibleProviders(games: Esport[]) {
    const eligible: Partial<Record<Esport, string[]>> = {};
    for (const provider of this.registry.providers) {
      const runtime = this.providerRuntime(provider.name);
      if (!runtime.active || runtime.status !== "active") continue;
      for (const game of games)
        try {
          provider.readEvents([game]);
          (eligible[game] ??= []).push(provider.name);
        } catch (error) {
          if (
            !(error instanceof StaleDataError) &&
            !(error instanceof ProviderUnavailableError)
          )
            throw error;
        }
    }
    return eligible;
  }
  operationalHealth() {
    const health = this.scheduler.health();
    const providers: Record<string, unknown> = { ...health.providers };
    for (const { name } of this.registry.providers) {
      const runtime = this.providerRuntime(name);
      if (!runtime.active || runtime.status === "unavailable")
        providers[name] = {
          ...(health.providers[name] ?? {
            lastListAttemptAt: null,
            lastListSuccessAt: null,
            nextListRunAt: null,
            consecutiveFailures: 0,
            lastError: null,
            cooldownUntil: null,
            activeJobs: 0,
            configuredConcurrency:
              this.config.settings.collection.concurrency[name],
            effectiveConcurrency: 1,
          }),
          status: runtime.status,
          active: runtime.active,
          reason: runtime.reason,
        };
      else
        providers[name] = {
          ...((providers[name] as Record<string, unknown>) ?? {}),
          active: true,
          reason: "active",
        };
    }
    return { ...health, providers };
  }
  async restoreCatalog() {
    if (this.persistence?.enabled && this.persistence.catalogEvents)
      this.scheduler.restoreCatalog(await this.persistence.catalogEvents());
  }
  async refresh() {
    const providers = this.registry.providers.filter(
      (provider) => this.providerRuntime(provider.name).active,
    );
    const outcomes = await Promise.allSettled(
      providers.map((provider) => provider.refresh()),
    );
    outcomes.forEach((r, i) => {
      if (r.status === "rejected")
        this.logger.warn(`${providers[i].name}: persisted state unavailable`);
    });
    return outcomes;
  }
  private async directOperation(
    provider: ProviderRuntime,
    job: CollectionJob,
    options: CollectOptions,
  ) {
    const signal = options.signal ?? new AbortController().signal;
    const run = this.ingestion.begin(provider.name);
    try {
      return await scheduledOperation(
        provider,
        job,
        options,
        signal,
        () => {},
        (publications) =>
          this.ingestion.commit(run, signal, () => {}, publications),
      );
    } finally {
      this.ingestion.finish(run);
    }
  }
  async collectCycle(
    names: string[],
    options: CycleOptions,
  ): Promise<CollectionResult[]> {
    if (this.config.settings.runtime === "server")
      throw Error("Collection disabled on server");
    return Promise.all(
      names.map(async (name) => {
        if (this.active.has(name) || this.scheduler.health().scheduler.running)
          return {
            provider: name,
            status: "busy" as const,
            events: 0,
            details: 0,
          };
        let count = 0,
          details = 0;
        this.active.add(name);
        try {
          const provider = this.registry.get(name);
          const events = await this.directOperation(
            provider,
            { kind: "list", provider: provider.name },
            options,
          );
          count = events.length;
          if (options.details)
            for (const game of options.esports) {
              const ref = provider.selectDetail(
                events.filter((e) => e.esport === game),
                options,
              );
              if (!ref) throw Error("No requested pre-game event");
              await this.directOperation(
                provider,
                { kind: "detail", provider: provider.name, event: ref },
                options,
              );
              details++;
            }
          return {
            provider: name,
            status: "ok" as const,
            events: count,
            details,
          };
        } catch (error) {
          this.logger.warn(
            `${name}: collection failed; accepted snapshots retained`,
          );
          return {
            provider: name,
            status: count ? ("partial" as const) : ("failed" as const),
            events: count,
            details,
            error: error instanceof Error ? error.name : "Error",
          };
        } finally {
          try {
            if (!options.retainClients)
              await this.registry.get(name).closeCollection();
          } catch {
            this.logger.warn(`${name}: transport cleanup failed`);
          }
          this.active.delete(name);
        }
      }),
    );
  }
  async runLoop(names: string[], options: CycleOptions, signal: AbortSignal) {
    if (this.config.settings.runtime === "server")
      throw Error("Collection disabled on server");
    return Promise.all(
      names.map(async (name) => {
        if (this.loops.has(name)) return false;
        const provider = this.registry.get(name);
        this.loops.add(name);
        let ok = true;
        try {
          while (!signal.aborted) {
            const batches =
              provider.pollCadence === "esport"
                ? options.esports.map((g) => [g])
                : [options.esports];
            for (const esports of batches) {
              if (signal.aborted) break;
              const [r] = await this.collectCycle([name], {
                ...options,
                esports,
                retainClients: true,
              });
              if (r.status !== "ok") {
                ok = false;
                break;
              }
              await delay(this.config.settings.pollingIntervalMs, undefined, {
                signal,
              }).catch(() => {});
            }
            if (!ok) break;
          }
          return ok;
        } finally {
          this.loops.delete(name);
          await provider.closeCollection();
        }
      }),
    );
  }
  async close() {
    await this.scheduler.stop();
    await Promise.allSettled(
      this.registry.providers.map((p) => p.closeCollection()),
    );
  }
  memoryDiagnostics() {
    return {
      sets: { active: this.active.size, loops: this.loops.size },
      scheduler: this.scheduler.memoryDiagnostics(),
      ingestion: this.ingestion.memoryDiagnostics(),
    };
  }
}
