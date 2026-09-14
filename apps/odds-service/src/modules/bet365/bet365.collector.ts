import {
  collectionStep,
  publishCapture,
} from "../../shared/utils/collection-operation.js";
import { Injectable, Inject, Logger } from "@nestjs/common";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Bet365Client } from "./bet365.client.js";
import { AppConfiguration } from "../../config/configuration.js";
import { saveJson } from "../../shared/utils/files.js";
import type { CollectOptions } from "../../shared/interfaces/odds-provider.interface.js";
import type { ProviderEventRef } from "../../shared/domain/provider-event-ref.js";
import type { Capture, Esport } from "./types/model.js";
import { codes } from "./types/model.js";
import { parseCapture } from "./parsers/list.parser.js";
import { parseDetail } from "./parsers/coupon.parser.js";
import {
  eventRoute,
  isReadOnlyTab,
  normalizeRound,
  type DetailRound,
} from "./persistence/detail.store.js";
import { normalizedBet365 } from "./mappers/bet365.mapper.js";
import {
  ProviderParseError,
  ProviderTransportError,
} from "../../shared/errors/domain-errors.js";
@Injectable()
export class Bet365Collector {
  private readonly logger = new Logger("Bet365");
  private client?: Awaited<ReturnType<Bet365Client["open"]>>;
  private out = "";
  private listings = new Map<Esport, Capture>();
  constructor(
    @Inject(Bet365Client) private readonly factory: Bet365Client,
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
  ) {}
  private async open(options: CollectOptions) {
    if (!this.client) {
      const opened = await this.factory.open(options);
      if (options.signal?.aborted) {
        await opened.close();
        options.signal.throwIfAborted();
      }
      this.client = opened;
      this.out = join(
        this.config.settings.captureDir,
        new Date().toISOString().replace(/[:.]/g, "-"),
      );
      await mkdir(this.out, { recursive: true });
      await mkdir(this.config.settings.inboxDir, { recursive: true });
      await mkdir(this.config.settings.detailInboxDir, { recursive: true });
    }
    return this.client;
  }
  async collectEvents(options: CollectOptions) {
    options.signal?.throwIfAborted();
    const client = await this.open(options);
    const events = [];
    for (const esport of options.esports) {
      let c: Capture;
      try {
        c = await collectionStep(
          client.capture(
            esport,
            `#AC#B151#C1#D50#E${codes[esport]}#F163#`,
            "/contentdata/othersportsmatchmarketscontentapi/list",
          ),
          options.signal,
        );
      } catch (e) {
        throw new ProviderTransportError("bet365", e);
      }
      const file = c.capturedAt.replace(/[:.]/g, "-") + "-" + esport + ".json";
      await saveJson(join(this.out, file), c);
      let parsed;
      try {
        parsed = parseCapture(c);
      } catch (e) {
        throw new ProviderParseError("bet365", e);
      }
      await publishCapture(
        options,
        join(this.config.settings.inboxDir, file),
        c,
      );
      this.listings.set(esport, c);
      events.push(...normalizedBet365(parsed.matches, parsed.provenance));
      this.logger.log(`${esport}: ${parsed.matches.length} events`);
    }
    return events;
  }
  async collectEventDetails(ref: ProviderEventRef, options: CollectOptions) {
    const listing = this.listings.get(ref.esport);
    if (!listing)
      throw new ProviderParseError("bet365", Error("Missing listing context"));
    options.signal?.throwIfAborted();
    const client = await this.open(options);
    const route = eventRoute(listing, ref.eventId),
      parsed = parseCapture(listing),
      match = parsed.matches.find((e) => e.eventId === ref.eventId);
    if (!match)
      throw new ProviderParseError(
        "bet365",
        Error("Event absent from listing"),
      );
    const capture = async (pd: string, index: number) => {
      const c = await collectionStep(
        client.capture(
          ref.esport,
          pd,
          "/contentdata/othersportsmatchbettingcontentapi/coupon",
        ),
        options.signal,
      );
      await saveJson(
        join(
          this.out,
          c.capturedAt.replace(/[:.]/g, "-") +
            "-" +
            ref.esport +
            "-coupon-" +
            index +
            ".json",
        ),
        c,
      );
      return c;
    };
    const detail = await capture(route, 0),
      first = parseDetail(detail, {
        match,
        inPlay: parsed.provenance[ref.eventId].inPlay,
      }),
      captures = [detail];
    if (!options.mainOnly)
      for (const tab of first.tabs.filter(isReadOnlyTab)) {
        if (tab.pd !== route)
          captures.push(await capture(tab.pd, captures.length));
      }
    const round: DetailRound = {
        eventId: ref.eventId,
        listing,
        captures,
        coverage: options.mainOnly ? "main" : "all_tabs",
      },
      result = normalizeRound(round),
      stamp = result.match.fetchedAt.replace(/[:.]/g, "-"),
      file = `${stamp}-${ref.esport}-${ref.eventId}.json`;
    await saveJson(join(this.out, file), round);
    await saveJson(
      join(this.out, `${stamp}-${ref.esport}-${ref.eventId}-normalized.json`),
      result.match,
    );
    await publishCapture(
      options,
      join(this.config.settings.detailInboxDir, file),
      round,
    );
    this.logger.log(`${ref.esport}: ${result.match.markets.length} markets`);
    return {
      ...normalizedBet365([match], parsed.provenance)[0],
      ...result.match,
    };
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
    const client = this.client;
    this.client = undefined;
    this.listings.clear();
    if (client) await client.close();
  }
}
