import { LocalCdpService } from "../../shared/browser/local-cdp.service.js";
import {
  PERSISTENCE,
  type PersistencePort,
} from "../../shared/interfaces/persistence-port.interface.js";
import { AdaptiveScheduler } from "./adaptive-scheduler.js";
import { scheduledOperation } from "./scheduled-operation.js";
import { Injectable, Inject, Logger, Optional } from "@nestjs/common";
import { setTimeout as delay } from "node:timers/promises";
import { ProviderRegistry } from "./provider-registry.js";
import { AppConfiguration } from "../../config/configuration.js";
import type { CollectOptions } from "../../shared/interfaces/odds-provider.interface.js";
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
@Injectable()
export class CollectionService {
  private readonly logger = new Logger("Collection");
  private readonly active = new Set<string>();
  private readonly loops = new Set<string>();
  readonly scheduler: AdaptiveScheduler;
  constructor(
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
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
        .filter((p) => this.runtimeEnabled(p.name))
        .map((p) => p.name),
      async (job, signal, commit) => {
        if (this.active.has(job.provider))
          throw Error("Provider already collecting");
        this.active.add(job.provider);
        try {
          return await scheduledOperation(
            registry.get(job.provider),
            job,
            { esports: config.settings.esports, existing: true },
            signal,
            commit,
          );
        } finally {
          this.active.delete(job.provider);
        }
      },
      (entry) => this.logger.log(JSON.stringify(entry)),
    );
  }
  private runtimeEnabled(name: string) {
    if (name === "estrelabet") return this.config.settings.estrelabetEnabled;
    if (name === "blaze") return this.config.settings.blazeEnabled;
    if (name !== "bet365" && name !== "betano") return true;
    return (
      this.config.settings.providerEnabled[name] &&
      this.config.settings.browser.runtime === "local-cdp" &&
      process.platform === "darwin"
    );
  }
  operationalHealth() {
    const health = this.scheduler.health();
    const providers: Record<string, unknown> = { ...health.providers };
    if (this.localCdp)
      for (const name of ["bet365", "betano"] as const) {
        const status = this.localCdp.availability(name);
        if (status === "disabled" || status === "unavailable")
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
            status,
          };
      }
    return { ...health, providers };
  }
  async restoreCatalog() {
    if (this.persistence?.enabled && this.persistence.catalogEvents)
      this.scheduler.restoreCatalog(await this.persistence.catalogEvents());
  }
  async refresh() {
    const outcomes = await Promise.allSettled(
      this.registry.providers.map((p) => p.refresh()),
    );
    outcomes.forEach((r, i) => {
      if (r.status === "rejected")
        this.logger.warn(
          `${this.registry.providers[i].name}: inbox unavailable`,
        );
    });
    return outcomes;
  }
  async collectCycle(
    names: string[],
    options: CycleOptions,
  ): Promise<CollectionResult[]> {
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
          const events = await provider.collectEvents(options);
          count = events.length;
          if (options.details)
            for (const game of options.esports) {
              const ref = provider.selectDetail(
                events.filter((e) => e.esport === game),
                options,
              );
              if (!ref) throw Error("No requested pre-game event");
              await provider.collectEventDetails(ref, options);
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
}
