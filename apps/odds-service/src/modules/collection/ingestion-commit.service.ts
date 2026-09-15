import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Provider } from "../../shared/domain/normalized-event.js";

export interface IngestionRun {
  provider: Provider;
  id: string;
}

/** Owns the in-process generation check and the provider commit critical section. */
@Injectable()
export class IngestionCommitService {
  private readonly logger = new Logger("DirectIngestion");
  private readonly generations = new Map<Provider, string>();
  private readonly tails = new Map<Provider, Promise<void>>();

  begin(provider: Provider): IngestionRun {
    const run = { provider, id: randomUUID() };
    this.generations.set(provider, run.id);
    return run;
  }

  async commit(
    run: IngestionRun,
    signal: AbortSignal,
    beginCommit: () => void,
    publications: Array<() => Promise<void>>,
  ) {
    const previous = this.tails.get(run.provider) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(run.provider, tail);
    await previous;
    try {
      signal.throwIfAborted();
      if (this.generations.get(run.provider) !== run.id)
        throw Error("Superseded collection run");
      beginCommit();
      this.logger.log(
        JSON.stringify({
          event: "commit_started",
          provider: run.provider,
          collectionRunId: run.id,
        }),
      );
      for (const publish of publications) await publish();
      this.logger.log(
        JSON.stringify({
          event: "commit_ok",
          provider: run.provider,
          collectionRunId: run.id,
        }),
      );
    } finally {
      release();
      if (this.tails.get(run.provider) === tail)
        this.tails.delete(run.provider);
    }
  }

  finish(run: IngestionRun) {
    if (this.generations.get(run.provider) === run.id)
      this.generations.delete(run.provider);
  }
}
