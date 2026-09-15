export type BrowserProvider = "bet365" | "betano";

interface FeedResponse {
  url: string;
  status: number;
  capturedAt: string;
  body: string;
}

const origins = {
  bet365: "https://www.bet365.bet.br",
  betano: "https://www.betano.bet.br",
};

/** The only Chrome targets this class can touch are IDs returned by tabs.create. */
export class OwnedTab {
  private closed = false;
  private currentUrl = "about:blank";

  private constructor(
    readonly provider: BrowserProvider,
    readonly tabId: number,
  ) {}

  static async open(provider: BrowserProvider) {
    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    if (typeof tab.id !== "number") throw Error("Own Chrome tab ID missing");
    const owner = new OwnedTab(provider, tab.id);
    try {
      await chrome.debugger.attach({ tabId: tab.id }, "1.3");
      await owner.command("Page.enable");
      await owner.command("Network.enable");
      if (provider === "bet365")
        await owner.command("Network.setCacheDisabled", {
          cacheDisabled: true,
        });
      await owner.navigate(origins[provider] + "/");
      return owner;
    } catch (error) {
      await owner.close();
      throw error;
    }
  }

  private command(method: string, params: Record<string, unknown> = {}) {
    if (this.closed) throw Error("Owned Chrome tab closed");
    return chrome.debugger.sendCommand({ tabId: this.tabId }, method, params);
  }

  async evaluate(expression: string): Promise<unknown> {
    const response = (await this.command("Runtime.evaluate", {
      expression,
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    return response?.result?.value;
  }

  async navigate(url: string) {
    const destination = new URL(url);
    if (
      destination.origin !== origins[this.provider] ||
      destination.pathname !== "/"
    )
      throw Error("Unsupported bookmaker navigation");
    if (
      this.provider === "bet365" &&
      destination.hash &&
      (!/^#\/(?:[A-Z][A-Za-z0-9^.-]*\/)+$/.test(destination.hash) ||
        destination.hash.includes("I99"))
    )
      throw Error("Unadvertised Bet365 route");
    const result = (await this.command(
      this.currentUrl === url ? "Page.reload" : "Page.navigate",
      this.currentUrl === url ? {} : { url },
    )) as {
      errorText?: string;
    };
    if (result?.errorText) throw Error("Bookmaker page navigation failed");
    this.currentUrl = url;
  }

  async retryClick(expression: string, timeout = 25000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if ((await this.evaluate(expression).catch(() => false)) === true) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw Error("Bookmaker navigation unavailable");
  }

  async capture(
    pathname: string,
    accept: (url: URL) => boolean,
    action: () => Promise<void>,
    timeout = 25000,
    acceptBody?: (body: string) => boolean,
  ): Promise<FeedResponse> {
    const candidates = new Map<
      string,
      { status: number; url: string; at: string; cache: string }
    >();
    let skipped = 0;
    let lastKind = "none";
    let lastCache = "none";
    let otherPdResponses = 0;
    let resolve!: (response: FeedResponse) => void;
    let reject!: (error: Error) => void;
    const result = new Promise<FeedResponse>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void result.catch(() => {});
    const onEvent = (
      source: chrome.debugger.DebuggerSession,
      method: string,
      rawParams?: object,
    ) => {
      if (source.tabId !== this.tabId) return;
      const params = (rawParams ?? {}) as Record<string, unknown>;
      if (method === "Network.responseReceived") {
        const response = params.response as {
          url?: string;
          status?: number;
          fromDiskCache?: boolean;
          fromServiceWorker?: boolean;
          fromPrefetchCache?: boolean;
        };
        const requestId = params.requestId;
        if (typeof response?.url !== "string" || typeof requestId !== "string")
          return;
        let url: URL;
        try {
          url = new URL(response.url);
        } catch {
          return;
        }
        if (url.origin !== origins[this.provider] || url.pathname !== pathname)
          return;
        if (!accept(url)) {
          otherPdResponses++;
          return;
        }
        candidates.set(requestId, {
          status: Number(response.status),
          url: url.href,
          at: new Date().toISOString(),
          cache: response.fromDiskCache
            ? "disk"
            : response.fromServiceWorker
              ? "service-worker"
              : response.fromPrefetchCache
                ? "prefetch"
                : "network",
        });
      }
      if (
        method === "Network.loadingFailed" &&
        typeof params.requestId === "string" &&
        candidates.has(params.requestId)
      )
        reject(Error("Bookmaker feed network failure"));
      if (
        method !== "Network.loadingFinished" ||
        typeof params.requestId !== "string"
      )
        return;
      const selected = candidates.get(params.requestId);
      if (!selected) return;
      candidates.delete(params.requestId);
      const requestId = params.requestId;
      void (async () => {
        try {
          if (selected.status !== 200)
            throw Error(`Bookmaker feed HTTP ${selected.status}`);
          const raw = (await this.command("Network.getResponseBody", {
            requestId,
          })) as unknown as { body: string; base64Encoded?: boolean };
          const body = raw.base64Encoded ? decodeBase64(raw.body) : raw.body;
          if (acceptBody && !acceptBody(body)) {
            skipped++;
            lastKind = !body
              ? "empty"
              : body.startsWith("<")
                ? "html"
                : body.startsWith("{")
                  ? "json"
                  : "other";
            lastCache = selected.cache;
            return;
          }
          resolve({
            url: selected.url,
            status: selected.status,
            capturedAt: selected.at,
            body,
          });
        } catch (error) {
          reject(
            error instanceof Error ? error : Error("Feed body unavailable"),
          );
        }
      })();
    };
    const onDetach = (source: chrome.debugger.Debuggee) => {
      if (source.tabId === this.tabId)
        reject(Error("Owned Chrome debugger detached"));
    };
    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.onDetach.addListener(onDetach);
    const timer = setTimeout(
      () =>
        reject(
          Error(
            skipped
              ? `Bookmaker full feed unavailable; skipped=${skipped}, kind=${lastKind}, cache=${lastCache}, otherPd=${otherPdResponses}`
              : "Bookmaker feed timed out",
          ),
        ),
      timeout,
    );
    try {
      await action();
      return await result;
    } finally {
      clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await chrome.tabs.remove(this.tabId).catch(() => {});
  }
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}
