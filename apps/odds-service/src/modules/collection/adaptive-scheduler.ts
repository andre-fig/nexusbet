import { isTransportFailure } from "./collection-failure.js";
import type { CollectionSettings } from "../../config/collection.configuration.js";
import type {
  NormalizedEvent,
  Provider,
} from "../../shared/domain/normalized-event.js";
import type { ProviderEventRef } from "../../shared/domain/provider-event-ref.js";
import {
  getDetailInterval,
  backoff,
  CollectionTimeoutError,
  EventStartedError,
} from "./scheduling-policy.js";
export interface AttemptState {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextRunAt: number | null;
  failureCount: number;
  lastError: string | null;
  currentlyRunning: boolean;
  jitter: number;
}
export interface DetailState extends AttemptState, ProviderEventRef {
  startsAt: string;
  preGameStopped?: boolean;
}
export interface ProviderState {
  provider: Provider;
  list: AttemptState;
  consecutiveFailures: number;
  cooldownUntil: number | null;
  contextReady: boolean;
  activeJobs: number;
  configuredConcurrency: number;
  effectiveConcurrency: number;
}
export type CollectionJob =
  | { kind: "list"; provider: Provider }
  | { kind: "detail"; provider: Provider; event: ProviderEventRef };
export type ExecuteJob = (
  job: CollectionJob,
  signal: AbortSignal,
  beginCommit: () => void,
) => Promise<NormalizedEvent[]>;
export interface CatalogChange {
  type: "EventAdded" | "EventRemoved";
  provider: Provider;
  eventId: string;
  at: number;
}
interface Running {
  controller: AbortController;
  promise: Promise<void>;
  committing: boolean;
}
const attempt = (): AttemptState => ({
  lastAttemptAt: null,
  lastSuccessAt: null,
  nextRunAt: null,
  failureCount: 0,
  lastError: null,
  currentlyRunning: false,
  jitter: 0,
});
const key = (provider: Provider, id: string) => provider + ":" + id;
const eligible = (e: NormalizedEvent, now: number) =>
  !e.inPlay &&
  ["scheduled", "suspended"].includes(e.status) &&
  getDetailInterval(e.startsAt, now) !== null;
/** One in-memory queue, derived from unique state entries. No per-event timers. */
export class AdaptiveScheduler {
  readonly providers = new Map<Provider, ProviderState>();
  readonly details = new Map<string, DetailState>();
  readonly catalog = new Map<string, NormalizedEvent>();
  readonly catalogChanges = new Map<Provider, CatalogChange[]>();
  private readonly jobs = new Map<string, Running>();
  private enabled = false;
  private stopping = false;
  constructor(
    readonly config: CollectionSettings,
    names: Provider[],
    private readonly execute: ExecuteJob,
    private readonly log: (message: Record<string, unknown>) => void = () => {},
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {
    for (const provider of names)
      this.providers.set(provider, {
        provider,
        list: attempt(),
        consecutiveFailures: 0,
        cooldownUntil: null,
        contextReady: false,
        activeJobs: 0,
        configuredConcurrency: config.concurrency[provider],
        effectiveConcurrency: 1,
      });
  }
  private jitter() {
    return Math.floor(this.random() * Math.min(this.config.jitterMs, 10000));
  }
  start() {
    if (this.enabled || this.stopping) return;
    this.enabled = true;
    for (const p of this.providers.values()) {
      p.list.nextRunAt = this.now() + this.config.startupDelayMs;
      p.list.jitter = this.jitter();
      if (p.configuredConcurrency > 1)
        this.log({
          event: "concurrency_capped",
          provider: p.provider,
          effective: 1,
          reason: "single_browser_transport",
        });
    }
  }
  private state(job: CollectionJob) {
    return job.kind === "list"
      ? this.providers.get(job.provider)!.list
      : this.details.get(key(job.provider, job.event.eventId))!;
  }
  private due(s: AttemptState, now: number) {
    return (
      !s.currentlyRunning &&
      s.nextRunAt !== null &&
      now >= s.nextRunAt + s.jitter
    );
  }
  private recalculate(now: number) {
    for (const [k, s] of this.details) {
      const e = this.catalog.get(k);
      if (!e || s.preGameStopped || !eligible(e, now)) {
        s.nextRunAt = null;
        continue;
      }
      if (!s.failureCount) {
        const interval = getDetailInterval(
          s.startsAt,
          now,
          this.config.detail,
        )!;
        s.nextRunAt =
          s.lastAttemptAt === null
            ? (s.nextRunAt ?? now)
            : s.lastAttemptAt + interval;
      }
    }
  }
  tick() {
    if (!this.enabled || this.stopping) return;
    const now = this.now();
    this.recalculate(now);
    for (const p of this.providers.values()) {
      if (
        p.activeJobs >= p.effectiveConcurrency ||
        (p.cooldownUntil !== null && now < p.cooldownUntil)
      )
        continue;
      if (p.cooldownUntil !== null) {
        p.cooldownUntil = null;
        p.list.nextRunAt = now;
        p.list.jitter = 0;
        p.contextReady = false;
        this.log({ event: "provider_probe", provider: p.provider });
      }
      if (this.due(p.list, now)) {
        this.launch({ kind: "list", provider: p.provider });
        continue;
      }
      if (!p.contextReady) continue;
      const next = [...this.details.values()]
        .filter((s) => s.provider === p.provider && this.due(s, now))
        .sort(
          (a, b) =>
            Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
            a.eventId.localeCompare(b.eventId),
        )[0];
      if (next)
        this.launch({
          kind: "detail",
          provider: p.provider,
          event: {
            provider: p.provider,
            eventId: next.eventId,
            esport: next.esport,
          },
        });
    }
  }
  private launch(job: CollectionJob) {
    const id =
      job.kind === "list"
        ? job.provider + ":list"
        : key(job.provider, job.event.eventId);
    if (this.jobs.has(id)) return;
    const p = this.providers.get(job.provider)!,
      s = this.state(job),
      at = this.now();
    s.currentlyRunning = true;
    s.lastAttemptAt = at;
    p.activeJobs++;
    const running: Running = {
      controller: new AbortController(),
      committing: false,
      promise: Promise.resolve(),
    };
    this.jobs.set(id, running);
    const timeout = setTimeout(
      () => running.controller.abort(new CollectionTimeoutError()),
      job.kind === "list"
        ? this.config.listTimeoutMs
        : this.config.detailTimeoutMs,
    );
    this.log({
      event: "collection_start",
      provider: job.provider,
      kind: job.kind,
      ...(job.kind === "detail" ? { eventId: job.event.eventId } : {}),
    });
    running.promise = (async () => {
      try {
        const events = await this.execute(
          job,
          running.controller.signal,
          () => {
            running.controller.signal.throwIfAborted();
            running.committing = true;
            clearTimeout(timeout);
          },
        );
        if (!running.committing) running.controller.signal.throwIfAborted();
        if (job.kind === "list") {
          this.reconcile(job.provider, events);
          p.contextReady = true;
        }
        s.lastSuccessAt = this.now();
        s.failureCount = 0;
        s.lastError = null;
        p.consecutiveFailures = 0;
        p.cooldownUntil = null;
        const interval =
          job.kind === "list"
            ? this.config.listIntervalMs
            : getDetailInterval(
                (s as DetailState).startsAt,
                this.now(),
                this.config.detail,
              );
        s.nextRunAt = interval === null ? null : at + interval;
        s.jitter = this.jitter();
        this.log({
          event: "collection_ok",
          ...(job.kind === "detail" ? { eventId: job.event.eventId } : {}),
          provider: job.provider,
          kind: job.kind,
          count:
            job.kind === "list" ? events.length : events[0]?.markets.length,
          nextRunAt: s.nextRunAt,
        });
      } catch (error) {
        if (error instanceof EventStartedError) {
          (s as DetailState).preGameStopped = true;
          s.nextRunAt = null;
          return;
        }
        if (
          this.stopping &&
          running.controller.signal.aborted &&
          !(running.controller.signal.reason instanceof CollectionTimeoutError)
        )
          return;
        s.failureCount++;
        s.lastError =
          running.controller.signal.reason instanceof CollectionTimeoutError
            ? "timeout"
            : error instanceof Error
              ? error.name
              : "Error";
        p.consecutiveFailures++;
        const resetContext =
          job.kind === "list" ||
          running.controller.signal.aborted ||
          isTransportFailure(error);
        if (resetContext) p.contextReady = false;
        const wait = backoff(s.failureCount, this.config.backoffMs);
        s.nextRunAt = this.now() + wait;
        s.jitter = this.jitter();
        // Closing a failed transport invalidates its listing context. Recover through discovery first.
        if (resetContext)
          p.list.nextRunAt = Math.max(p.list.nextRunAt ?? 0, this.now() + wait);
        if (p.consecutiveFailures >= this.config.failureThreshold)
          p.cooldownUntil = this.now() + this.config.cooldownMs;
        this.log({
          event: p.cooldownUntil ? "provider_degraded" : "collection_failed",
          ...(job.kind === "detail" ? { eventId: job.event.eventId } : {}),
          provider: job.provider,
          kind: job.kind,
          error: s.lastError,
          failureCount: s.failureCount,
          backoffMs: wait,
          cooldownUntil: p.cooldownUntil,
        });
      } finally {
        clearTimeout(timeout);
        s.currentlyRunning = false;
        p.activeJobs--;
        this.jobs.delete(id);
      }
    })();
  }
  restoreCatalog(events: NormalizedEvent[]) {
    if (this.enabled || this.jobs.size)
      throw Error("Cannot restore a running scheduler");
    for (const provider of this.providers.keys())
      this.reconcile(
        provider,
        events.filter((e) => e.provider === provider),
      );
    this.catalogChanges.clear();
  }
  private reconcile(provider: Provider, events: NormalizedEvent[]) {
    const next = new Map(events.map((e) => [key(provider, e.eventId), e])),
      changes: CatalogChange[] = [];
    const now = this.now();
    for (const [k, e] of this.catalog)
      if (e.provider === provider && !next.has(k)) {
        changes.push({
          type: "EventRemoved",
          provider,
          eventId: e.eventId,
          at: now,
        });
        this.catalog.delete(k);
        this.details.delete(k);
      }
    for (const [k, e] of next) {
      if (!this.catalog.has(k))
        changes.push({
          type: "EventAdded",
          provider,
          eventId: e.eventId,
          at: now,
        });
      this.catalog.set(k, e);
      let s = this.details.get(k);
      if (!s) {
        s = {
          ...attempt(),
          provider,
          eventId: e.eventId,
          esport: e.esport,
          startsAt: e.startsAt,
        };
        s.jitter = this.jitter();
        this.details.set(k, s);
      }
      if (s.startsAt !== e.startsAt) s.preGameStopped = false;
      s.startsAt = e.startsAt;
      s.esport = e.esport;
    }
    this.catalogChanges.set(provider, changes);
    this.recalculate(now);
  }
  async drain() {
    await Promise.all([...this.jobs.values()].map((j) => j.promise));
  }
  async stop() {
    if (this.stopping) {
      await this.drain();
      return;
    }
    this.log({ event: "scheduler_stopping", activeJobs: this.jobs.size });
    this.stopping = true;
    this.enabled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.drain(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.config.shutdownGraceMs);
        }),
      ]);
      for (const j of this.jobs.values())
        if (!j.committing) j.controller.abort(new Error("Shutdown"));
      await this.drain();
    } finally {
      clearTimeout(timer);
      this.log({ event: "scheduler_stopped", activeJobs: this.jobs.size });
    }
  }
  memoryDiagnostics() {
    return {
      maps: {
        providers: this.providers.size,
        details: this.details.size,
        catalog: this.catalog.size,
        catalogChanges: this.catalogChanges.size,
        jobs: this.jobs.size,
      },
      catalogChanges: [...this.catalogChanges.values()].reduce(
        (count, changes) => count + changes.length,
        0,
      ),
    };
  }
  health() {
    const now = this.now();
    const iso = (v: number | null) =>
      v === null ? null : new Date(v).toISOString();
    const providers = Object.fromEntries(
      [...this.providers].map(([name, p]) => [
        name,
        {
          status: p.consecutiveFailures
            ? "degraded"
            : p.list.lastSuccessAt === null
              ? "starting"
              : "ok",
          lastListAttemptAt: iso(p.list.lastAttemptAt),
          lastListSuccessAt: iso(p.list.lastSuccessAt),
          nextListRunAt: iso(p.list.nextRunAt),
          consecutiveFailures: p.consecutiveFailures,
          lastError: p.list.lastError,
          cooldownUntil: iso(p.cooldownUntil),
          activeJobs: p.activeJobs,
          configuredConcurrency: p.configuredConcurrency,
          effectiveConcurrency: p.effectiveConcurrency,
        },
      ]),
    );
    const queued =
      [...this.providers.values()].filter((p) => this.due(p.list, now)).length +
      [...this.details.values()].filter((s) => this.due(s, now)).length;
    return {
      status: [...this.providers.values()].some((p) => p.consecutiveFailures)
        ? "degraded"
        : "ok",
      providers,
      scheduler: {
        running: this.enabled && !this.stopping,
        queuedJobs: queued,
        activeJobs: this.jobs.size,
        scheduledDetails: [...this.details.values()].filter(
          (s) => s.nextRunAt !== null,
        ).length,
      },
    };
  }
}
