import { Inject, Injectable } from "@nestjs/common";
import { AppConfiguration } from "../../config/configuration.js";
import { ProviderTransportError } from "../../shared/errors/domain-errors.js";
import {
  API_BASE,
  COMMON_QUERY,
  object,
  type EstrelaBetCapture,
} from "./types/feed.js";
@Injectable()
export class EstrelaBetClient {
  private readonly active = new Set<AbortController>();
  constructor(
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
  ) {}
  async snapshot(
    signal?: AbortSignal,
    eventId?: string,
  ): Promise<EstrelaBetCapture> {
    const controller = new AbortController();
    this.active.add(controller);
    const combined = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(
        eventId
          ? this.config.settings.collection.detailTimeoutMs
          : this.config.settings.collection.listTimeoutMs,
      ),
      ...(signal ? [signal] : []),
    ]);
    const path = eventId
      ? `GetEventDetails?${COMMON_QUERY}&eventId=${encodeURIComponent(eventId)}&showNonBoosts=false`
      : `GetUpcoming?${COMMON_QUERY}&sportId=145&eventCount=20`;
    const get = async (path: string): Promise<unknown> => {
      const r = await fetch(API_BASE + path, {
        signal: combined,
        redirect: "error",
      });
      if (!r.ok) throw Error(`EstrelaBet HTTP ${r.status}`);
      if (!r.headers.get("content-type")?.includes("application/json"))
        throw Error("EstrelaBet non-JSON response");
      return r.json();
    };
    try {
      const data: EstrelaBetCapture["data"] = {};
      if (eventId) data.detail = await get(path);
      else {
        const first = object(await get(path));
        const count = first.pageCount;
        if (
          !Number.isSafeInteger(count) ||
          Number(count) < 1 ||
          Number(count) > 100 ||
          first.page !== 1
        )
          throw Error("Invalid EstrelaBet pagination");
        data.pages = [first];
        for (let page = 2; page <= Number(count); page++) {
          const next = object(await get(path + "&page=" + page));
          if (next.page !== page || next.pageCount !== count)
            throw Error("EstrelaBet pagination changed; incomplete round");
          data.pages.push(next);
        }
      }
      combined.throwIfAborted();
      return {
        provider: "estrelabet",
        capturedAt: new Date().toISOString(),
        status: 200,
        source: {
          transport: "http",
          url: API_BASE + path,
          method: "GET",
          capture: "direct-http",
          authenticated: false,
        },
        data,
      };
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ProviderTransportError("estrelabet", e);
    } finally {
      this.active.delete(controller);
    }
  }
  async close() {
    for (const c of this.active) c.abort();
  }
}
