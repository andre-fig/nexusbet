import { projectCapture } from "./parsers/capture-projection.js";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { AppConfiguration } from "../../config/configuration.js";
import {
  ProviderParseError,
  ProviderUnavailableError,
} from "../../shared/errors/domain-errors.js";
import { EventStartedError } from "../collection/scheduling-policy.js";
import type { CollectOptions } from "../../shared/interfaces/odds-provider.interface.js";
import type { ProviderEventRef } from "../../shared/domain/provider-event-ref.js";
import { publishCapture } from "../../shared/utils/collection-operation.js";
import { BlazeClient } from "./blaze.client.js";
import { parseListing, parseDetail } from "./parsers/feed.parser.js";
import type { BlazeRound } from "./types/feed.js";
@Injectable()
export class BlazeCollector {
  private readonly logger = new Logger("Blaze");
  constructor(
    @Inject(BlazeClient) private readonly client: BlazeClient,
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
  ) {}
  private enabled() {
    if (!this.config.settings.blazeEnabled)
      throw new ProviderUnavailableError("blaze", Error("Provider disabled"));
  }
  private parse<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof EventStartedError) throw e;
      throw new ProviderParseError("blaze", e);
    }
  }
  private async publish(round: BlazeRound, options: CollectOptions) {
    await mkdir(this.config.settings.blazeInboxDir, { recursive: true });
    await publishCapture(
      options,
      join(
        this.config.settings.blazeInboxDir,
        `${Date.now()}-${randomUUID()}.json`,
      ),
      { ...round, capture: projectCapture(round.capture, round.esport) },
    );
  }
  async collectEvents(options: CollectOptions) {
    this.enabled();
    const capture = await this.client.snapshot(options.signal);
    const rounds = options.esports.map((esport) => ({
      kind: "listing" as const,
      esport,
      capture,
    }));
    const events = rounds.flatMap((r) =>
      this.parse(() => {
        const events = parseListing(capture, r.esport);
        if (!events.length)
          throw Error("Empty Blaze feed is not authoritative removal");
        return events;
      }),
    );
    options.signal?.throwIfAborted();
    for (const r of rounds) await this.publish(r, options);
    this.logger.log(`List OK: ${events.length} events`);
    return events;
  }
  async collectEventDetails(ref: ProviderEventRef, options: CollectOptions) {
    this.enabled();
    if (ref.provider !== "blaze") throw Error("Wrong provider");
    const capture = await this.client.snapshot(options.signal, true);
    const event = this.parse(() =>
      parseDetail(capture, ref.esport, ref.eventId),
    );
    await this.publish(
      { kind: "detail", esport: ref.esport, eventId: ref.eventId, capture },
      options,
    );
    this.logger.log(`Detail ${ref.eventId}: ${event.markets.length} markets`);
    return event;
  }
  async close() {
    await this.client.close();
  }
}
