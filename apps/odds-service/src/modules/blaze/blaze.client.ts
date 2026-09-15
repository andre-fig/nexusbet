import { Inject, Injectable } from "@nestjs/common";
import { AppConfiguration } from "../../config/configuration.js";
import { ProviderTransportError } from "../../shared/errors/domain-errors.js";
import {
  OFFER_ORIGIN,
  PREMATCH_PATH,
  DESCRIPTIONS_PATH,
  object,
  type BlazeCapture,
} from "./types/feed.js";
@Injectable()
export class BlazeClient {
  private readonly active = new Set<AbortController>();
  constructor(
    @Inject(AppConfiguration) private readonly config: AppConfiguration,
  ) {}
  /** The anonymous full snapshot contains detail markets; never replay the blocked event endpoint. */
  async snapshot(signal?: AbortSignal, detail = false): Promise<BlazeCapture> {
    const controller = new AbortController();
    this.active.add(controller);
    const combined = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(
        detail
          ? this.config.settings.collection.detailTimeoutMs
          : this.config.settings.collection.listTimeoutMs,
      ),
      ...(signal ? [signal] : []),
    ]);
    const get = async (path: string): Promise<unknown> => {
      const response = await fetch(OFFER_ORIGIN + path, {
        signal: combined,
        redirect: "error",
      });
      if (!response.ok) throw Error(`Blaze HTTP ${response.status}`);
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw Error("Blaze non-JSON response");
      return response.json();
    };
    try {
      const manifest = object(await get(PREMATCH_PATH + "0"));
      if (
        !Array.isArray(manifest.top_events_versions) ||
        !Array.isArray(manifest.rest_events_versions)
      )
        throw Error("Missing snapshot manifest");
      const versions = [
        ...manifest.top_events_versions,
        ...manifest.rest_events_versions,
      ];
      if (
        !versions.length ||
        versions.length > 100 ||
        versions.some((v) => !Number.isSafeInteger(v) || v <= 0) ||
        new Set(versions).size !== versions.length
      )
        throw Error("Invalid snapshot versions");
      const shards = [];
      for (const version of versions)
        shards.push({ version, data: await get(PREMATCH_PATH + version) });
      const descriptions = await get(DESCRIPTIONS_PATH);
      return {
        provider: "blaze",
        capturedAt: new Date().toISOString(),
        status: 200,
        source: {
          transport: "http",
          url: OFFER_ORIGIN + PREMATCH_PATH + "0",
          method: "GET",
          capture: "direct-http",
          authenticated: false,
        },
        data: { manifest, shards, descriptions },
      };
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ProviderTransportError("blaze", e);
    } finally {
      this.active.delete(controller);
    }
  }
  async close() {
    for (const c of this.active) c.abort();
  }
}
