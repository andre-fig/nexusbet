import { LocalCdpService } from "../../shared/browser/local-cdp.service.js";
import "reflect-metadata";
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigService } from "@nestjs/config";
import { AppConfiguration, configuration } from "../../config/configuration.js";
import { Bet365Client } from "../bet365/bet365.client.js";
import { Bet365Collector } from "../bet365/bet365.collector.js";
import { BetanoClient } from "../betano/betano.client.js";
import { BetanoCollector } from "../betano/betano.collector.js";

const mode = "headed" as const;
const provider = process.argv.includes("--betano") ? "betano" : "bet365";
const requestedCycles = process.argv.includes("--two-cycles") ? 2 : 1;
const base = configuration().settings;
const directory = join(
  base.browser.evidenceDir,
  "diagnostic",
  process.platform,
  mode,
  new Date().toISOString().replace(/[:.]/g, "-"),
);
const config = new AppConfiguration(
  new ConfigService({
    settings: {
      ...base,
      persistenceMode: "file",
      ingestEnabled: false,
      browser: {
        ...base.browser,
        mode,
        profileDir: join(
          base.browser.profileDir,
          "diagnostic",
          process.platform,
          mode,
        ),
        evidenceDir: directory,
      },
      captureDir: join(directory, "captures"),
      betanoCaptureDir: join(directory, "captures-betano"),
      inboxDir: join(directory, "unused-inbox"),
      detailInboxDir: join(directory, "unused-detail-inbox"),
      betanoInboxDir: join(directory, "unused-betano-inbox"),
    },
  }),
);
const manager = new LocalCdpService(config);
const collector =
  provider === "bet365"
    ? new Bet365Collector(new Bet365Client(config, manager), config)
    : new BetanoCollector(new BetanoClient(config, manager), config);
const steps: Record<string, unknown>[] = [];
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
let current = "startup";
try {
  for (let cycle = 1; cycle <= requestedCycles; cycle++) {
    for (const esport of base.esports) {
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(base.collection.listTimeoutMs),
      ]);
      // Deferred publications intentionally never run: diagnostic data cannot replace valid snapshots.
      const options = {
        esports: [esport],
        signal,
        publications: [] as Array<() => Promise<void>>,
      };
      current = `${cycle}:${esport}:list`;
      const events = await collector.collectEvents(options);
      steps.push({
        stage: current,
        status: "ok",
        events: events.length,
        at: new Date().toISOString(),
      });
      const event = events.find(
        (e) => !e.inPlay && Date.parse(e.startsAt) > Date.now(),
      );
      if (!event) throw Error("No eligible pre-game event");
      current = `${cycle}:${esport}:detail`;
      const detail = await collector.collectEventDetails(
        { provider, eventId: event.eventId, esport },
        {
          ...options,
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(base.collection.detailTimeoutMs),
          ]),
        },
      );
      steps.push({
        stage: current,
        status: "ok",
        eventId: event.eventId,
        markets: detail.markets.length,
        at: new Date().toISOString(),
      });
    }
    // Real repeat cadence follows configuration, never aggressive recovery/polling.
    if (cycle < requestedCycles) {
      const { setTimeout } = await import("node:timers/promises");
      await setTimeout(base.collection.listIntervalMs, undefined, {
        signal: controller.signal,
      });
    }
  }
} catch (error) {
  // Error text may contain URLs, selectors or page content. Persist only a constrained category.
  const chain =
    error instanceof Error
      ? [
          error.message,
          error.cause instanceof Error ? error.cause.message : "",
        ].join(" ")
      : "";
  const http = chain.match(/(?:Homepage|Feed|Betano) HTTP (\d{3})/);
  steps.push({
    stage: current,
    status: "failed",
    errorClass: error instanceof Error ? error.name : "unknown",
    causeClass:
      error instanceof Error && error.cause instanceof Error
        ? error.cause.name
        : null,
    cdpUnavailable: /unavailable|CDP|Chrome connection/.test(chain),
    navigationMissing: /navigation|link unavailable|homepage unavailable/.test(
      chain,
    ),
    feedTimeout: /Frontend did not provide|feed response timeout/i.test(chain),
    reason: http ? `HTTP ${http[1]}` : "navigation_or_feed_unavailable",
    at: new Date().toISOString(),
  });
  process.exitCode = 1;
} finally {
  try {
    await collector.close();
  } finally {
    await manager.close();
  }
  await mkdir(directory, { recursive: true });
  const result = {
    provider,
    mode,
    requestedCycles,
    authenticated: null,
    runtime: base.browser.runtime,
    profileIsolatedByMode: false,
    ownership: "own-targets-only",
    steps,
    stoppedAfterFirstFailure: true,
  };
  await writeFile(
    join(directory, provider + "-result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
