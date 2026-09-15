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
import { EstrelaBetClient } from "./estrelabet.client.js";
import { parseListing, parseDetail } from "./parsers/feed.parser.js";
import type { EstrelaBetRound } from "./types/feed.js";
@Injectable()
export class EstrelaBetCollector {
  private readonly logger = new Logger("EstrelaBet");
  constructor(
    @Inject(EstrelaBetClient) private readonly client: EstrelaBetClient,
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
  ) {}
  private enabled() {
    if (!this.config.settings.estrelabetEnabled)
      throw new ProviderUnavailableError(
        "estrelabet",
        Error("Provider disabled"),
      );
  }
  private parse<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof EventStartedError) throw e;
      throw new ProviderParseError("estrelabet", e);
    }
  }
  private async publish(round: EstrelaBetRound, options: CollectOptions) {
    await mkdir(this.config.settings.estrelabetInboxDir, { recursive: true });
    await publishCapture(
      options,
      join(
        this.config.settings.estrelabetInboxDir,
        `${Date.now()}-${randomUUID()}.json`,
      ),
      round,
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
          throw Error("Empty EstrelaBet feed is not authoritative removal");
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
    if (ref.provider !== "estrelabet") throw Error("Wrong provider");
    const capture = await this.client.snapshot(options.signal, ref.eventId);
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
