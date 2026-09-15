import { chromeResources } from "./browser-resources.js";
import { Injectable, Inject, OnApplicationShutdown } from "@nestjs/common";
import type { BrowserContext, Page } from "playwright-core";
import { join } from "node:path";
import { AppConfiguration } from "../../config/configuration.js";
import { OwnedBrowser } from "./owned-browser.js";
import { BrowserEvidence, evidenceUrl } from "./browser-evidence.js";
import { nativeDebugEndpoint } from "./endpoint.js";

interface TabState {
  provider: string;
  page?: Page;
  detail?: Page;
  detailOpening?: Promise<Page>;
  detailBusy?: boolean;
  pending?: Promise<Page>;
  pageClosing?: Promise<void>;
  status: "starting" | "ready" | "degraded" | "closed";
  lastUsedAt: string | null;
  lastSuccessAt: string | null;
  busy: boolean;
  failureCount: number;
}

/** Sole owner of Chrome/context. Provider transports only borrow their fixed page. */
@Injectable()
export class BrowserManagerService implements OnApplicationShutdown {
  private readonly browser: OwnedBrowser;
  private context?: BrowserContext;
  private opening?: Promise<BrowserContext>;
  private sparePage?: Page;
  private evidence?: BrowserEvidence;
  private readonly tabs = new Map<string, TabState>();
  private readonly active = new Set<Promise<unknown>>();
  private warmupTail: Promise<unknown> = Promise.resolve();
  private stopping = false;
  private resourceSample?: Promise<void>;
  private resources: Awaited<ReturnType<typeof chromeResources>> = null;
  private lastResourceSample = 0;
  private closing?: Promise<void>;
  constructor(@Inject(AppConfiguration) readonly config: AppConfiguration) {
    if (!config.settings.browser.persistent)
      throw Error("Shared Chrome requires BROWSER_PERSISTENT=true");
    this.browser = new OwnedBrowser(config.settings.browser, "shared", true);
  }
  private state(provider: string): TabState {
    if (!/^[a-z][a-z0-9-]*$/.test(provider)) throw Error("Invalid provider");
    let state = this.tabs.get(provider);
    if (!state) {
      state = {
        provider,
        status: "starting",
        lastUsedAt: null,
        lastSuccessAt: null,
        busy: false,
        failureCount: 0,
      };
      this.tabs.set(provider, state);
    }
    return state;
  }
  private ensureContext(): Promise<BrowserContext> {
    if (this.stopping) return Promise.reject(Error("Browser manager stopping"));
    if (this.context) return Promise.resolve(this.context);
    return (this.opening ??= (async () => {
      const context = await this.browser.open();
      this.context = context;
      this.sparePage = context.pages()[0];
      this.evidence = new BrowserEvidence(context, false);
      context.once("close", () => {
        if (this.context !== context) return;
        this.context = undefined;
        this.sparePage = undefined;
        this.evidence = undefined;
        for (const state of this.tabs.values()) {
          state.page = undefined;
          state.detail = undefined;
          state.status = "closed";
        }
      });
      return context;
    })().finally(() => {
      this.opening = undefined;
    }));
  }
  async getPage(provider: string): Promise<Page> {
    if (this.stopping) throw Error("Browser manager stopping");
    const state = this.state(provider);
    if (state.page && !state.page.isClosed()) return state.page;
    return (state.pending ??= (async () => {
      await state.pageClosing;
      const context = await this.ensureContext();
      const spare = this.sparePage;
      this.sparePage = undefined;
      const page = spare && !spare.isClosed() ? spare : await context.newPage();
      state.page = page;
      state.status = "starting";
      page.once("close", () => {
        if (state.page === page) {
          state.page = undefined;
          state.status = "closed";
        }
      });
      page.once("crash", () => {
        if (state.page === page) {
          state.page = undefined;
          state.status = "degraded";
        }
        state.pageClosing = page.close().catch(() => {});
      });
      return page;
    })().finally(() => {
      state.pending = undefined;
    }));
  }
  isCurrent(provider: string, page: Page) {
    return (
      !!this.context &&
      this.tabs.get(provider)?.page === page &&
      !page.isClosed()
    );
  }
  async attach(provider: string) {
    const page = await this.getPage(provider);
    const session = await page.context().newCDPSession(page);
    try {
      const { targetInfo } = await session.send("Target.getTargetInfo");
      return {
        page,
        targetId: targetInfo.targetId,
        endpoint: await nativeDebugEndpoint(
          join(this.browser.profilePath, "DevToolsActivePort"),
        ),
      };
    } finally {
      await session.detach();
    }
  }
  /** Full provider job lock, including transitions between listing/detail navigation. */
  runExclusive<T>(
    provider: string,
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const state = this.state(provider);
    if (this.stopping) return Promise.reject(Error("Browser manager stopping"));
    if (state.busy) return Promise.reject(Error("Provider page busy"));
    state.busy = true;
    state.lastUsedAt = new Date().toISOString();
    const job = (async () => {
      try {
        signal?.throwIfAborted();
        await this.getPage(provider);
        signal?.throwIfAborted();
        const result = await action();
        signal?.throwIfAborted();
        state.lastSuccessAt = new Date().toISOString();
        state.failureCount = 0;
        state.status = "ready";
        return result;
      } catch (error) {
        state.failureCount++;
        state.status = "degraded";
        // An aborted Playwright action may still be waiting on a locator. Closing only
        // this target cancels it before releasing the lock, preventing late navigation.
        if (signal?.aborted) await this.invalidatePage(provider);
        throw error;
      } finally {
        await this.closeDetail(provider);
        state.busy = false;
      }
    })();
    this.active.add(job);
    void job.finally(() => this.active.delete(job)).catch(() => {});
    return job;
  }
  /** Serialize first homepage/SPA warmup, not steady-state jobs on distinct tabs. */
  warmup<T>(action: () => Promise<T>): Promise<T> {
    const result = this.warmupTail
      .catch(() => {})
      .then(() => {
        if (this.stopping) throw Error("Browser manager stopping");
        return action();
      });
    this.warmupTail = result.catch(() => {});
    return result;
  }
  private async invalidatePage(provider: string) {
    const state = this.state(provider);
    const page = state.page;
    state.page = undefined;
    state.status = "closed";
    await this.closeDetail(provider);
    await page?.close().catch(() => {});
  }
  async recoverPage(provider: string) {
    if (this.state(provider).busy) throw Error("Provider page busy");
    await this.invalidatePage(provider);
    return this.getPage(provider);
  }
  async recoverBrowser() {
    if (this.active.size) throw Error("Browser jobs still active");
    await this.browser.close();
    // Persistent contexts own the Chrome process; context/browser recovery coincide.
    await Promise.all(
      [...this.tabs.keys()].map((provider) => this.getPage(provider)),
    );
  }
  /** Optional detail tab exists only inside an already locked provider operation. */
  async withDetailPage<T>(
    provider: string,
    action: (page: Page) => Promise<T>,
  ): Promise<T> {
    const state = this.state(provider);
    if (!state.busy || !this.config.settings.browser.detailTabMax)
      throw Error("Detail tab unavailable");
    if (state.detailBusy) throw Error("Detail tab busy");
    state.detailBusy = true;
    try {
      const main = await this.getPage(provider);
      state.detailOpening = main.context().newPage();
      state.detail = await state.detailOpening;
      return await action(state.detail);
    } finally {
      await this.closeDetail(provider);
      state.detailBusy = false;
    }
  }
  private async closeDetail(provider: string) {
    const state = this.state(provider);
    const opening = state.detailOpening;
    const detail = opening
      ? await opening.catch(() => undefined)
      : state.detail;
    state.detailOpening = undefined;
    state.detail = undefined;
    await detail?.close().catch(() => {});
  }
  async saveEvidence(provider: string) {
    const page = this.tabs.get(provider)?.page;
    if (!page || page.isClosed()) return;
    await this.evidence
      ?.save(
        join(this.config.settings.browser.evidenceDir, provider),
        "shared-" + new Date().toISOString().replace(/[:.]/g, "-"),
        {},
        page,
      )
      .catch(() => {});
  }
  health() {
    const memory = process.memoryUsage();
    if (!this.resourceSample && Date.now() - this.lastResourceSample > 10000) {
      this.lastResourceSample = Date.now();
      this.resourceSample = chromeResources()
        .then((sample) => {
          this.resources = sample;
        })
        .catch(() => {})
        .finally(() => {
          this.resourceSample = undefined;
        });
    }
    return {
      mode: this.config.settings.browser.mode,
      sharedInstance: true,
      sharedContext: true,
      browsers: this.context ? 1 : 0,
      contexts: this.context ? 1 : 0,
      tabs: this.context?.pages().length ?? 0,
      resources: this.resources,
      nodeRssBytes: memory.rss,
      nodeHeapUsedBytes: memory.heapUsed,
      providers: Object.fromEntries(
        [...this.tabs].map(([provider, s]) => [
          provider,
          {
            status: s.status,
            currentUrl: s.page ? evidenceUrl(s.page.url()) : null,
            lastUsedAt: s.lastUsedAt,
            lastSuccessAt: s.lastSuccessAt,
            busy: s.busy,
            failureCount: s.failureCount,
            mainTabs: s.page && !s.page.isClosed() ? 1 : 0,
            detailTabs: s.detail ? 1 : 0,
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
      await this.opening?.catch(() => {});
      await Promise.all(
        [...this.tabs.values()].map(async (state) => {
          await state.pending?.catch(() => {});
          await this.closeDetail(state.provider);
          await state.page?.close().catch(() => {});
        }),
      );
      await this.browser.close();
    })());
  }
  onApplicationShutdown() {
    return this.close();
  }
}
