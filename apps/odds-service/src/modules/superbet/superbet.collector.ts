import { Injectable, Inject, Logger } from "@nestjs/common";
import { AppConfiguration } from "../../config/configuration.js";
import { ProviderParseError } from "../../shared/errors/domain-errors.js";
import { EventStartedError } from "../collection/scheduling-policy.js";
import type { CollectOptions } from "../../shared/interfaces/odds-provider.interface.js";
import type { ProviderEventRef } from "../../shared/domain/provider-event-ref.js";
import { publishCapture } from "../../shared/utils/collection-operation.js";
import { saveRawCapture } from "../../shared/utils/raw-capture.js";
import { SuperbetClient } from "./superbet.client.js";
import { parseDetail, parseListing } from "./parsers/feed.parser.js";
import type { SuperbetCapture, SuperbetRound } from "./types/feed.js";
@Injectable()
export class SuperbetCollector {
  private structure?: SuperbetCapture;
  private readonly logger = new Logger("Superbet");
  constructor(
    @Inject(SuperbetClient) private readonly client: SuperbetClient,
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
  ) {}
  private parse<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof EventStartedError) throw e;
      throw new ProviderParseError("superbet", e);
    }
  }
  private async publish(round: SuperbetRound, options: CollectOptions) {
    await saveRawCapture(
      this.config.settings,
      "superbet",
      `${round.kind}-${round.esport}.json`,
      round,
    );
    return publishCapture(options, round);
  }
  async collectEvents(options: CollectOptions) {
    const structure = await this.client.structure(options.signal),
      rounds: SuperbetRound[] = [],
      events = [];
    for (const esport of options.esports) {
      const capture = await this.client.list(esport, options.signal);
      events.push(
        ...this.parse(() => parseListing(capture, esport, structure)),
      );
      rounds.push({ kind: "listing", esport, capture, structure });
    }
    options.signal?.throwIfAborted();
    for (const round of rounds) await this.publish(round, options);
    this.structure = structure;
    this.logger.log(`List OK: ${events.length} events`);
    return events;
  }
  async collectEventDetails(ref: ProviderEventRef, options: CollectOptions) {
    if (ref.provider !== "superbet") throw Error("Wrong provider");
    const structure =
        this.structure ?? (await this.client.structure(options.signal)),
      capture = await this.client.detail(ref.eventId, options.signal);
    const event = this.parse(() =>
      parseDetail(capture, ref.esport, ref.eventId, structure),
    );
    await this.publish(
      {
        kind: "detail",
        esport: ref.esport,
        eventId: ref.eventId,
        capture,
        structure,
      },
      options,
    );
    this.logger.log(`Detail ${ref.eventId}: ${event.markets.length} markets`);
    return event;
  }
  async close() {
    await this.client.close();
  }
}
