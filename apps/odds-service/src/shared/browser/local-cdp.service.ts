import { Injectable, Inject, OnApplicationShutdown } from "@nestjs/common";
import { AppConfiguration } from "../../config/configuration.js";
import { ProviderUnavailableError } from "../errors/domain-errors.js";
import { ChromeTab } from "./chrome-tab.js";
import { nativeDebugEndpoint } from "./endpoint.js";

type LocalProvider = "bet365" | "betano";
interface OwnedTab {
  tab?: ChromeTab;
  pending?: Promise<ChromeTab>;
  busy: boolean;
  status: "starting" | "ready" | "unavailable";
  lastSuccessAt: string | null;
}
/** Borrows the existing macOS Chrome process. Owns targets, never the browser/context/profile. */
@Injectable()
export class LocalCdpService implements OnApplicationShutdown {
  private readonly tabs = new Map<LocalProvider, OwnedTab>();
  private readonly active = new Set<Promise<unknown>>();
  private stopping = false;
  private retryAt = 0;
  private endpoint?: string;
  private warmupTail: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  constructor(@Inject(AppConfiguration) readonly config: AppConfiguration) {}
  availability(provider: LocalProvider) {
    if (!this.config.settings.providerEnabled[provider]) return "disabled";
    if (
      this.config.settings.browser.runtime !== "local-cdp" ||
      process.platform !== "darwin"
    )
      return "unavailable";
    if (Date.now() < this.retryAt) return "unavailable";
    return this.tabs.get(provider)?.status ?? "starting";
  }
  private state(provider: LocalProvider) {
    let state = this.tabs.get(provider);
    if (!state) {
      state = { busy: false, status: "starting", lastSuccessAt: null };
      this.tabs.set(provider, state);
    }
    return state;
  }
  private async getTab(provider: LocalProvider): Promise<ChromeTab> {
    const status = this.availability(provider);
    if (
      this.stopping ||
      status === "disabled" ||
      Date.now() < this.retryAt ||
      this.config.settings.browser.runtime !== "local-cdp" ||
      process.platform !== "darwin"
    )
      throw new ProviderUnavailableError(provider);
    const state = this.state(provider);
    if (state.tab) return state.tab;
    return (state.pending ??= (async () => {
      try {
        this.endpoint =
          this.config.settings.cdpUrl ??
          (await nativeDebugEndpoint(this.config.settings.chromeDebugPortFile));
        // No targetId: ChromeTab creates a new target in the existing personal context.
        const tab = await ChromeTab.open(this.endpoint);
        try {
          const version = await tab.cdp.send("Browser.getVersion");
          if (
            !/Macintosh/.test(version.userAgent ?? "") ||
            /HeadlessChrome/.test(version.userAgent ?? "")
          )
            throw new ProviderUnavailableError(provider);
        } catch (error) {
          await tab.close().catch(() => {});
          throw error;
        }
        state.tab = tab;
        const disconnected = () => {
          if (state.tab !== tab) return;
          state.tab = undefined;
          state.status = "unavailable";
          this.retryAt =
            Date.now() + this.config.settings.cdpReconnectCooldownMs;
        };
        const detached = (message: {
          method: string;
          sessionId?: string;
          params?: { sessionId?: string };
        }) => {
          if (
            (message.method === "Inspector.detached" &&
              message.sessionId === tab.sessionId) ||
            (message.method === "Target.detachedFromTarget" &&
              message.params?.sessionId === tab.sessionId)
          ) {
            if (state.tab === tab) state.tab = undefined;
            state.status = "unavailable";
            tab.cdp.off("protocol", detached);
            tab.cdp.off("disconnected", disconnected);
            tab.releaseConnection();
          }
        };
        tab.cdp.on("protocol", detached);
        const close = tab.close.bind(tab);
        tab.close = async () => {
          tab.cdp.off("protocol", detached);
          tab.cdp.off("disconnected", disconnected);
          await close();
        };
        tab.cdp.once("disconnected", disconnected);
        return tab;
      } catch {
        state.status = "unavailable";
        this.retryAt = Date.now() + this.config.settings.cdpReconnectCooldownMs;
        throw new ProviderUnavailableError(provider);
      }
    })().finally(() => {
      state.pending = undefined;
    }));
  }
  async openFeed<T extends { close(): Promise<void> }>(
    provider: LocalProvider,
    open: (endpoint: string, targetId: string) => Promise<T>,
    detach: (feed: T) => Promise<void>,
  ) {
    const tab = await this.getTab(provider);
    const feed = await open(this.endpoint!, tab.targetId);
    let closing: Promise<void> | undefined;
    feed.close = () => (closing ??= detach(feed));
    return Object.assign(feed, {
      isCurrent: () => !closing && this.tabs.get(provider)?.tab === tab,
    });
  }
  runExclusive<T>(
    provider: LocalProvider,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const state = this.state(provider);
    if (this.stopping)
      return Promise.reject(new ProviderUnavailableError(provider));
    if (state.busy) return Promise.reject(Error("Provider page busy"));
    state.busy = true;
    const job = (async () => {
      try {
        signal?.throwIfAborted();
        await this.getTab(provider);
        signal?.throwIfAborted();
        const result = await action();
        signal?.throwIfAborted();
        state.status = "ready";
        state.lastSuccessAt = new Date().toISOString();
        return result;
      } catch (error) {
        state.status = "unavailable";
        if (signal?.aborted) await this.closeTab(provider);
        throw error;
      } finally {
        state.busy = false;
      }
    })();
    this.active.add(job);
    void job.finally(() => this.active.delete(job)).catch(() => {});
    return job;
  }
  warmup<T>(action: () => Promise<T>): Promise<T> {
    const result = this.warmupTail
      .catch(() => {})
      .then(() => {
        if (this.stopping) throw Error("Local CDP stopping");
        return action();
      });
    this.warmupTail = result.catch(() => {});
    return result;
  }
  private async closeTab(provider: LocalProvider) {
    const state = this.state(provider);
    const tab = state.tab;
    state.tab = undefined;
    // ChromeTab.close sends Target.closeTarget for this owned target, then releases CDP.
    await tab?.close().catch(() => {});
  }
  health() {
    return {
      runtime: this.config.settings.browser.runtime,
      mode: "headed",
      ownership: "own-targets-only",
      ownedTabs: [...this.tabs.values()].filter((s) => s.tab).length,
      reconnectAfter:
        this.retryAt > Date.now() ? new Date(this.retryAt).toISOString() : null,
      providers: Object.fromEntries(
        (["bet365", "betano"] as const).map((p) => [
          p,
          {
            status: this.availability(p),
            lastSuccessAt: this.tabs.get(p)?.lastSuccessAt ?? null,
            busy: this.tabs.get(p)?.busy ?? false,
          },
        ]),
      ),
    };
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      this.stopping = true;
      await Promise.allSettled([...this.active]);
      await this.warmupTail;
      for (const [provider, state] of this.tabs) {
        await state.pending?.catch(() => {});
        await this.closeTab(provider);
      }
    })());
  }
  onApplicationShutdown() {
    return this.close();
  }
}
