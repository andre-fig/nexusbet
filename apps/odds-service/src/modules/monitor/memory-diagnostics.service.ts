import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getActiveResourcesInfo, memoryUsage } from "node:process";
import { getHeapStatistics, writeHeapSnapshot } from "node:v8";
import { AppConfiguration } from "../../config/configuration.js";
import type { ProviderMemoryDiagnostics } from "../../shared/utils/memory-diagnostics.js";
import { CollectionService } from "../collection/collection.service.js";
import { ProviderRegistry } from "../collection/provider-registry.js";
import { MonitorEventsService } from "./monitor-events.service.js";

@Injectable()
export class MemoryDiagnosticsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger("MemoryDiagnostics");
  private startupTimer?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private finalTimer?: ReturnType<typeof setTimeout>;
  private running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
    @Inject(CollectionService) private readonly collection: CollectionService,
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
    @Inject(MonitorEventsService)
    private readonly monitorEvents: MonitorEventsService,
  ) {}

  onApplicationBootstrap() {
    const settings = this.config.settings;
    if (!settings.memoryDiagnosticsEnabled) return;
    this.startupTimer = setTimeout(() => {
      this.runSample("startup", settings.memoryDiagnosticsHeapSnapshots);
      this.interval = setInterval(
        () => this.runSample("interval", false),
        settings.memoryDiagnosticsIntervalMs,
      );
    }, settings.memoryDiagnosticsStartupDelayMs);
    if (settings.memoryDiagnosticsHeapSnapshots)
      this.finalTimer = setTimeout(
        () => this.runSample("final", true),
        settings.memoryDiagnosticsStartupDelayMs +
          settings.memoryDiagnosticsHeapSnapshotAfterMs,
      );
    this.logger.log(
      JSON.stringify({
        event: "memory_diagnostics_enabled",
        startupDelayMs: settings.memoryDiagnosticsStartupDelayMs,
        intervalMs: settings.memoryDiagnosticsIntervalMs,
        heapSnapshots: settings.memoryDiagnosticsHeapSnapshots,
        heapSnapshotAfterMs: settings.memoryDiagnosticsHeapSnapshotAfterMs,
      }),
    );
  }

  private runSample(phase: "startup" | "interval" | "final", heap: boolean) {
    this.running = this.running
      .then(() => this.sample(phase, heap))
      .catch((error) =>
        this.logger.error(
          JSON.stringify({
            event: "memory_diagnostics_failed",
            phase,
            error: error instanceof Error ? error.name : "Error",
          }),
        ),
      );
  }

  private async sample(
    phase: "startup" | "interval" | "final",
    heapSnapshot: boolean,
  ) {
    const providers: Record<string, ProviderMemoryDiagnostics> = {};
    for (const provider of this.registry.providers) {
      const diagnostic = provider.memoryDiagnostics?.();
      if (diagnostic) providers[provider.name] = diagnostic;
    }
    const totals = Object.values(providers).reduce(
      (total, provider) => ({
        events: total.events + provider.events,
        markets: total.markets + provider.markets,
        selections: total.selections + provider.selections,
        snapshots: total.snapshots + provider.snapshots,
        rawBytes: total.rawBytes + provider.rawBytes,
        approximateBytes: total.approximateBytes + provider.approximateBytes,
      }),
      {
        events: 0,
        markets: 0,
        selections: 0,
        snapshots: 0,
        rawBytes: 0,
        approximateBytes: 0,
      },
    );
    const resources = Object.fromEntries(
      [...new Set(getActiveResourcesInfo())]
        .sort()
        .map((type) => [
          type,
          getActiveResourcesInfo().filter((value) => value === type).length,
        ]),
    );
    const monitor = this.monitorEvents.memoryDiagnostics();
    this.logger.log(
      JSON.stringify({
        event: "memory_diagnostics",
        phase,
        at: new Date().toISOString(),
        memory: memoryUsage(),
        v8: getHeapStatistics(),
        totals: { ...totals, issues: monitor.previousIssues },
        providers,
        collection: this.collection.memoryDiagnostics(),
        monitor,
        activeResources: resources,
        processListeners: {
          warning: process.listenerCount("warning"),
          uncaughtException: process.listenerCount("uncaughtException"),
          unhandledRejection: process.listenerCount("unhandledRejection"),
          SIGTERM: process.listenerCount("SIGTERM"),
          SIGINT: process.listenerCount("SIGINT"),
        },
      }),
    );
    if (heapSnapshot) {
      const directory = join(
        this.config.settings.dataDir,
        "memory-diagnostics",
      );
      await mkdir(directory, { recursive: true });
      const path = join(directory, `heap-${phase}-${Date.now()}.heapsnapshot`);
      writeHeapSnapshot(path);
      this.logger.log(
        JSON.stringify({ event: "heap_snapshot_written", phase, path }),
      );
    }
  }

  async onApplicationShutdown() {
    clearTimeout(this.startupTimer);
    clearInterval(this.interval);
    clearTimeout(this.finalTimer);
    await this.running;
  }
}
