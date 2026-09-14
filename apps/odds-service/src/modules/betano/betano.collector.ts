import {
  normalizeListingRound,
  type ListingRound,
} from "./persistence/betano.store.js";
import {
  collectionStep,
  publishCapture,
} from "../../shared/utils/collection-operation.js";
import { Injectable, Inject, Logger } from "@nestjs/common";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BetanoClient } from "./betano.client.js";
import { AppConfiguration } from "../../config/configuration.js";
import { saveJson } from "../../shared/utils/files.js";
import type { CollectOptions } from "../../shared/interfaces/odds-provider.interface.js";
import type { ProviderEventRef } from "../../shared/domain/provider-event-ref.js";
import type { Esport } from "../../shared/types/common.js";
import {
  regions,
  parseListing,
  parseDetail,
  type BetanoCapture,
} from "./parsers/feed.parser.js";
import type { NormalizedEvent } from "../../shared/domain/normalized-event.js";
import { ProviderParseError } from "../../shared/errors/domain-errors.js";
interface League {
  id: string;
  name: string;
}
interface Context {
  region: { id: string; url: string };
  leagues: League[];
  events: NormalizedEvent[];
}
@Injectable()
export class BetanoCollector {
  private readonly logger = new Logger("Betano");
  private browser?: Awaited<ReturnType<BetanoClient["open"]>>;
  private out = "";
  private number = 0;
  private signal?: AbortSignal;
  private contexts = new Map<Esport, Context>();
  constructor(
    @Inject(BetanoClient) private readonly factory: BetanoClient,
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
  ) {}
  private async capture(
    action: () => Promise<void>,
    accept: (url: URL) => boolean,
  ) {
    this.signal?.throwIfAborted();
    const c = await collectionStep(
      this.browser!.capture(action, accept),
      this.signal,
    );
    await saveJson(join(this.out, `${++this.number}.json`), c);
    return c;
  }
  async collectEvents(options: CollectOptions) {
    options.signal?.throwIfAborted();
    await this.close();
    this.signal = options.signal;
    const opened = await this.factory.open();
    if (options.signal?.aborted) {
      await opened.close();
      options.signal.throwIfAborted();
    }
    this.browser = opened;
    this.browser.signal = options.signal;
    this.out = join(
      this.config.settings.betanoCaptureDir,
      new Date().toISOString().replace(/[:.]/g, "-"),
    );
    this.number = 0;
    await mkdir(this.out, { recursive: true });
    await mkdir(this.config.settings.betanoInboxDir, { recursive: true });
    const b = this.browser;
    await collectionStep(b.start(), options.signal);
    const directory = await this.capture(
      () => b.clickLink("/sport/esports/"),
      (u) => u.pathname === "/api/sport/esports/",
    );
    const allRegions =
      directory.data.regionGroups?.flatMap(
        (g: { regions: Context["region"][] }) => g.regions,
      ) ?? [];
    const events: NormalizedEvent[] = [];
    for (const esport of options.esports) {
      const region = allRegions.find(
        (r: { id: string }) => String(r.id) === regions[esport].id,
      );
      if (!region)
        throw new ProviderParseError("betano", Error("Modality absent"));
      const first = await this.capture(
          () => b.clickLink(region.url),
          (u) => u.pathname === "/api" + region.url,
        ),
        listings: BetanoCapture[] = [first],
        leagues: League[] = first.data.selectedLeagues;
      if (!Array.isArray(leagues) || !leagues.length)
        throw new ProviderParseError(
          "betano",
          Error("Competition coverage unavailable"),
        );
      for (const league of leagues) {
        if (
          first.data.blocks?.some(
            (block: { id: string }) => String(block.id) === String(league.id),
          )
        )
          continue;
        listings.push(
          await this.capture(
            () => b.clickText(league.name),
            (u) =>
              u.pathname === "/api" + region.url &&
              u.searchParams.get("sl") === String(league.id),
          ),
        );
      }
      const matches = listings.flatMap((c) => parseListing(c, esport)),
        dedup = [...new Map(matches.map((e) => [e.eventId, e])).values()];
      await publishListing(
        options,
        join(
          this.config.settings.betanoInboxDir,
          `${Date.now()}-${esport}-list.json`,
        ),
        {
          kind: "listing",
          esport,
          directory,
          regionId: region.id,
          expectedLeagues: leagues.map((l) => String(l.id)),
          captures: listings,
        },
      );
      this.contexts.set(esport, { region, leagues, events: dedup });
      events.push(...dedup);
      this.logger.log(
        `${esport}: ${dedup.length} events, ${leagues.length} competitions`,
      );
    }
    return events;
  }
  async collectEventDetails(ref: ProviderEventRef, options: CollectOptions) {
    options.signal?.throwIfAborted();
    this.signal = options.signal;
    if (this.browser) this.browser.signal = options.signal;
    const context = this.contexts.get(ref.esport),
      b = this.browser;
    if (!context || !b)
      throw new ProviderParseError("betano", Error("Missing listing context"));
    const event = context.events.find((e) => e.eventId === ref.eventId);
    if (!event)
      throw new ProviderParseError("betano", Error("Event not found"));
    await collectionStep(b.clickLink(context.region.url), options.signal);
    await delay(500);
    const league = context.leagues.find(
      (l) => String(l.id) === String(event.provenance.leagueId),
    );
    if (!league)
      throw new ProviderParseError("betano", Error("League not found"));
    await collectionStep(b.clickText(league.name), options.signal);
    await delay(500);
    const detail = await this.capture(
        () => b.clickLink(String(event.provenance.url)),
        (u) => u.pathname === "/api" + event.provenance.url,
      ),
      parsed = parseDetail(detail, ref.esport, ref.eventId);
    if (
      detail.data.markets?.find((tab: { selected?: boolean }) => tab.selected)
        ?.type !== "popular"
    )
      throw new ProviderParseError("betano", Error("Unexpected detail scope"));
    await publishCapture(
      options,
      join(
        this.config.settings.betanoInboxDir,
        `${Date.now()}-${ref.esport}-detail.json`,
      ),
      { kind: "detail", esport: ref.esport, capture: detail },
    );
    await saveJson(join(this.out, ref.esport + "-normalized.json"), parsed);
    const evidence = await collectionStep(b.evidence(), options.signal);
    await saveJson(join(this.out, ref.esport + "-ui.json"), evidence.state);
    await writeFile(join(this.out, ref.esport + "-ui.png"), evidence.png);
    this.logger.log(`${ref.esport}: ${parsed.markets.length} markets`);
    await collectionStep(b.clickLink("/sport/esports/"), options.signal);
    await delay(500);
    return parsed;
  }
  async recordFailure(operation: string, error: unknown) {
    if (this.out)
      await saveJson(join(this.out, "failure.json"), {
        at: new Date().toISOString(),
        operation,
        error: error instanceof Error ? error.name : "Error",
      });
  }
  async close() {
    const b = this.browser;
    this.browser = undefined;
    this.contexts.clear();
    if (b) await b.close();
  }
}

async function publishListing(
  options: CollectOptions,
  path: string,
  round: ListingRound,
) {
  normalizeListingRound(round);
  await publishCapture(options, path, round);
}
