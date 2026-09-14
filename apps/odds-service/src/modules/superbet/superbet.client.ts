import { Injectable, Inject } from "@nestjs/common";
import { AppConfiguration } from "../../config/configuration.js";
import { ProviderTransportError } from "../../shared/errors/domain-errors.js";
import type { Esport } from "../../shared/types/common.js";
import { OFFER_ORIGIN, SPORTS, type SuperbetCapture } from "./types/feed.js";
@Injectable()
export class SuperbetClient {
  private readonly active = new Set<AbortController>();
  constructor(
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
  ) {}
  async get(
    path: string,
    signal?: AbortSignal,
    detail = false,
  ): Promise<SuperbetCapture> {
    const url = new URL(path, OFFER_ORIGIN);
    if (
      url.origin !== OFFER_ORIGIN ||
      !/^\/v[23]\/pt-BR\/(?:struct|events(?:\/\d+)?)$/.test(url.pathname)
    )
      throw Error("Unsupported public feed URL");
    const controller = new AbortController();
    this.active.add(controller);
    const timeout = AbortSignal.timeout(
      detail
        ? this.config.settings.collection.detailTimeoutMs
        : this.config.settings.collection.listTimeoutMs,
    );
    const combined = AbortSignal.any([
      controller.signal,
      timeout,
      ...(signal ? [signal] : []),
    ]);
    try {
      const r = await fetch(url, {
        method: "GET",
        redirect: "error",
        signal: combined,
      });
      if (!r.ok) throw Error("HTTP " + r.status);
      const data: unknown = await r.json();
      combined.throwIfAborted();
      return {
        provider: "superbet",
        capturedAt: new Date().toISOString(),
        status: r.status,
        source: {
          transport: "http",
          method: "GET",
          url: url.href,
          capture: "direct-http",
          authenticated: false,
        },
        data,
      };
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      throw new ProviderTransportError("superbet", e);
    } finally {
      this.active.delete(controller);
    }
  }
  structure(signal?: AbortSignal) {
    return this.get("/v2/pt-BR/struct", signal);
  }
  list(esport: Esport, signal?: AbortSignal) {
    // Same 180-day window as the frontend's Todos calendar. Date parameters, not pagination.
    const now = Math.floor(Date.now() / 3600000) * 3600000,
      query = new URLSearchParams({
        startDate: new Date(now).toISOString(),
        endDate: new Date(now + 180 * 86400000).toISOString(),
        index: "active-prematch",
        sports: String(SPORTS[esport]),
      });
    return this.get("/v3/pt-BR/events?" + query, signal);
  }
  detail(id: string, signal?: AbortSignal) {
    if (!/^\d+$/.test(id)) throw Error("Invalid event ID");
    return this.get("/v2/pt-BR/events/" + id, signal, true);
  }
  async close() {
    for (const c of this.active) c.abort();
  }
}
