import { chromium, type BrowserContext, type Page } from "playwright-core";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrowserSettings } from "../../config/browser.configuration.js";
import { nativeDebugEndpoint } from "./endpoint.js";

export function launchOptions(config: BrowserSettings) {
  return {
    channel: config.channel,
    headless: config.mode === "headless",
    // Keep Playwright's automation indicators and Chrome's natural User-Agent.
    args: [
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      ...(config.mode === "headless" ? ["--headless=new"] : []),
    ],
    locale: config.locale,
    timezoneId: config.timezone,
    viewport: config.viewport,
    screen: config.viewport,
    colorScheme: "light" as const,
    deviceScaleFactor: 1,
    serviceWorkers: "allow" as const,
    timeout: 30000,
  };
}

/** One service-owned persistent context; never opens or copies a personal profile. */
export class OwnedBrowser {
  private context?: BrowserContext;
  private opening?: Promise<BrowserContext>;
  private ephemeral?: string;
  private closing?: Promise<void>;
  readonly profilePath: string;
  constructor(
    readonly config: BrowserSettings,
    readonly provider: string,
    profileRoot = false,
  ) {
    if (!/^[a-z][a-z0-9-]*$/.test(provider))
      throw Error("Invalid browser provider");
    this.profilePath = profileRoot
      ? config.profileDir
      : join(config.profileDir, provider);
  }
  open(): Promise<BrowserContext> {
    if (this.closing) return this.closing.then(() => this.open());
    if (this.context) return Promise.resolve(this.context);
    return (this.opening ??= this.launch().finally(() => {
      this.opening = undefined;
    }));
  }
  private async launch() {
    const profile = this.config.persistent
      ? this.profilePath
      : (this.ephemeral = await mkdtemp(join(tmpdir(), "odds-browser-")));
    await mkdir(profile, { recursive: true, mode: 0o700 });
    try {
      const context = await chromium.launchPersistentContext(
        profile,
        launchOptions(this.config),
      );
      this.context = context;
      context.on("close", () => {
        if (this.context === context) this.context = undefined;
      });
      return context;
    } catch (error) {
      if (this.ephemeral)
        await rm(this.ephemeral, { recursive: true, force: true });
      this.ephemeral = undefined;
      throw error;
    }
  }
  async attachInfo() {
    const context = await this.open();
    const page = context.pages()[0] ?? (await context.newPage());
    const session = await context.newCDPSession(page);
    try {
      const { targetInfo } = await session.send("Target.getTargetInfo");
      return {
        context,
        page,
        targetId: targetInfo.targetId,
        endpoint: await nativeDebugEndpoint(
          join(this.ephemeral ?? this.profilePath, "DevToolsActivePort"),
        ),
      };
    } finally {
      await session.detach();
    }
  }
  /** Explicit recovery, for transport failures only. Never use to retry a protection challenge. */
  async recover(
    step: "reload" | "page" | "context" | "browser",
  ): Promise<Page> {
    if (step === "context" || step === "browser") {
      // launchPersistentContext owns the browser: these two lifecycle steps are equivalent.
      await this.close();
      return (await this.attachInfo()).page;
    }
    const context = await this.open();
    if (step === "reload") {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.reload({ waitUntil: "domcontentloaded", timeout: 25000 });
      return page;
    }
    const old = context.pages();
    const page = await context.newPage();
    await Promise.all(old.map((p) => p.close()));
    return page;
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      await this.opening?.catch(() => {});
      const context = this.context;
      this.context = undefined;
      try {
        await context?.close();
      } finally {
        if (this.ephemeral)
          await rm(this.ephemeral, { recursive: true, force: true });
        this.ephemeral = undefined;
      }
    })().finally(() => {
      this.closing = undefined;
    }));
  }
}
