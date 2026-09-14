import { acquireCdp } from "./cdp-lease.js";
import { CdpConnection } from "./cdp-connection.js";
export class ChromeTab {
  protected constructor(
    readonly cdp: CdpConnection,
    public targetId: string,
    public sessionId: string,
    readonly browserContextId?: string,
    readonly releaseConnection: () => void = () => cdp.close(),
  ) {}
  static async open(endpoint: string, options: { anonymous?: boolean } = {}) {
    const lease = await acquireCdp(endpoint);
    const cdp = lease.cdp;
    let targetId: string | undefined, browserContextId: string | undefined;
    try {
      if (options.anonymous)
        ({ browserContextId } = await cdp.send(
          "Target.createBrowserContext",
          {},
        ));
      ({ targetId } = await cdp.send("Target.createTarget", {
        url: "about:blank",
        ...(browserContextId ? { browserContextId } : {}),
      }));
      const { sessionId } = await cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      const client = new ChromeTab(
        cdp,
        targetId!,
        sessionId,
        browserContextId,
        lease.release,
      );
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Network.enable", {}, sessionId);
      return client;
    } catch (e) {
      if (targetId)
        await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
      lease.release();
      throw e;
    }
  }
  // Native Chrome in this environment crashes on disposeBrowserContext. Leave the empty
  // isolated context to Chrome's lifecycle, closing only our last tab and connection.
  async close() {
    try {
      await this.cdp.send("Target.closeTarget", { targetId: this.targetId });
    } finally {
      this.releaseConnection();
    }
  }
}
