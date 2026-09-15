import type { BrowserContext, Page } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

/** URLs retain endpoint paths and parameter names, never query/hash values or credentials. */
export function evidenceUrl(input: string): string {
  try {
    const u = new URL(input);
    if (!["http:", "https:", "ws:", "wss:"].includes(u.protocol))
      return u.protocol;
    return (
      u.origin +
      u.pathname.replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]") +
      (u.search
        ? "?" +
          [...u.searchParams.keys()]
            .map((k) => encodeURIComponent(k) + "=[redacted]")
            .join("&")
        : "") +
      (u.hash ? "#[redacted]" : "")
    );
  } catch {
    return "[invalid-url]";
  }
}
type Entry = Record<string, unknown>;
export class BrowserEvidence {
  readonly events: Entry[] = [];
  private pending = new Set<Promise<void>>();
  private attached = new WeakSet<Page>();
  constructor(
    readonly context: BrowserContext,
    private readonly versionPageFallback = true,
  ) {
    const add = (e: Entry) => this.add(e);
    context.on("request", (r) =>
      add({
        kind: "request",
        method: r.method(),
        resource: r.resourceType(),
        url: evidenceUrl(r.url()),
        redirectFrom: r.redirectedFrom()
          ? evidenceUrl(r.redirectedFrom()!.url())
          : null,
      }),
    );
    context.on("response", (r) => {
      const task = (async () => {
        const size = await r
          .request()
          .sizes()
          .catch(() => null);
        add({
          kind: "response",
          url: evidenceUrl(r.url()),
          status: r.status(),
          resource: r.request().resourceType(),
          contentType: await r.headerValue("content-type").catch(() => null),
          responseBytes: size?.responseBodySize ?? null,
          fromServiceWorker: r.fromServiceWorker(),
        });
      })()
        .catch(() => {})
        .finally(() => this.pending.delete(task));
      this.pending.add(task);
    });
    context.on("requestfailed", (r) =>
      add({
        kind: "requestfailed",
        url: evidenceUrl(r.url()),
        resource: r.resourceType(),
      }),
    );
    context.on("serviceworker", (w) =>
      add({ kind: "serviceworker", url: evidenceUrl(w.url()) }),
    );
    context.on("page", (p) => this.attach(p));
    context.pages().forEach((p) => this.attach(p));
  }
  private add(entry: Entry) {
    if (this.events.length < 5000)
      this.events.push({ at: new Date().toISOString(), ...entry });
  }
  private attach(page: Page) {
    if (this.attached.has(page)) return;
    this.attached.add(page);
    page.on("console", (m) => {
      if (m.type() === "error")
        this.add({
          kind: "consoleError",
          location: evidenceUrl(m.location().url),
          line: m.location().lineNumber,
          message: "Console arguments omitted to avoid secrets",
        });
    });
    page.on("pageerror", (e) =>
      this.add({
        kind: "pageError",
        name: /^[A-Za-z]*Error$/.test(e.name) ? e.name : "Error",
        message: "Untrusted exception text omitted",
      }),
    );
    page.on("websocket", (ws) => {
      this.add({ kind: "websocket", url: evidenceUrl(ws.url()) });
      ws.on("socketerror", () =>
        this.add({ kind: "websocketError", url: evidenceUrl(ws.url()) }),
      );
      ws.on("close", () =>
        this.add({ kind: "websocketClosed", url: evidenceUrl(ws.url()) }),
      );
    });
  }
  async snapshot(page: Page) {
    const session = await this.context.newCDPSession(page);
    try {
      const version = await session.send("Browser.getVersion");
      await session.send("Performance.enable");
      const metrics = await session.send("Performance.getMetrics");
      const command = await session
        .send("Browser.getBrowserCommandLine")
        .catch(() => ({ arguments: [] as string[] }));
      let executablePath: string | null = command.arguments[0] ?? null;
      let commandLine: string | null = command.arguments.length
        ? command.arguments.join(" ")
        : null;
      if (!executablePath && this.versionPageFallback) {
        // Chrome's own version page reports the real executable and full launch command.
        // It contains no bookmaker cookies/headers and belongs to this owned context only.
        const versionPage = await this.context.newPage();
        try {
          await versionPage.goto("chrome://version", {
            waitUntil: "domcontentloaded",
            timeout: 5000,
          });
          executablePath = await versionPage
            .locator("#executable_path")
            .innerText();
          commandLine = await versionPage.locator("#command_line").innerText();
        } finally {
          await versionPage.close();
        }
      }
      const environment = await page
        .evaluate(async () => ({
          userAgent: navigator.userAgent,
          language: navigator.language,
          languages: navigator.languages,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          viewport: { width: innerWidth, height: innerHeight },
          screen: {
            width: screen.width,
            height: screen.height,
            deviceScaleFactor: devicePixelRatio,
          },
          colorScheme: matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light",
          localStorageKeys: Object.keys(localStorage),
          sessionStorageKeys: Object.keys(sessionStorage),
          indexedDB: (await indexedDB.databases()).map((d) => ({
            name: d.name,
            version: d.version,
          })),
          serviceWorkers:
            "serviceWorker" in navigator
              ? (await navigator.serviceWorker.getRegistrations()).map(
                  (r) => r.scope,
                )
              : [],
        }))
        .catch(() => null);
      return {
        version,
        resourceMetrics: metrics.metrics.filter((m) =>
          ["JSHeapUsedSize", "JSHeapTotalSize", "Documents", "Nodes"].includes(
            m.name,
          ),
        ),
        contextPages: this.context.pages().length,
        executablePath,
        commandLine,
        launchFlags: command.arguments.slice(1),
        playwright: createRequire(import.meta.url)(
          "playwright-core/package.json",
        ).version as string,
        url: evidenceUrl(page.url()),
        title: await page.title().catch(() => ""),
        environment,
        cookieNames: (await this.context.cookies()).map((c) => c.name).sort(),
        serviceWorkers: this.context
          .serviceWorkers()
          .map((w) => evidenceUrl(w.url())),
      };
    } finally {
      await session.detach();
    }
  }
  async save(
    directory: string,
    label: string,
    extra: Entry = {},
    targetPage?: Page,
  ) {
    if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw Error("Invalid evidence label");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const page =
      targetPage ??
      this.context.pages().find((p) => p.url() !== "about:blank") ??
      this.context.pages()[0];
    if (!page) return;
    const metadata = await this.snapshot(page);
    // Bound metadata flushing; sockets or failed navigation must not hang shutdown.
    await Promise.race([
      Promise.allSettled([...this.pending]),
      new Promise<void>((r) => {
        const timer = setTimeout(r, 1000);
        timer.unref();
      }),
    ]);
    await page
      .screenshot({ path: join(directory, label + ".png"), timeout: 5000 })
      .catch(() => {});
    await writeFile(
      join(directory, label + ".json"),
      JSON.stringify({ ...metadata, ...extra, events: this.events }, null, 2),
      { mode: 0o600 },
    );
  }
}
