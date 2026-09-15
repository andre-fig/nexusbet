import type { Page } from "playwright-core";
import { BrowserManagerService } from "./browser-manager.service.js";

/** Borrow a fixed target. Closing an adapter detaches CDP; only the manager owns pages/Chrome. */
export async function openManagedFeed<T extends { close(): Promise<void> }>(
  manager: BrowserManagerService,
  provider: string,
  open: (endpoint: string, targetId: string, page: Page) => Promise<T>,
  detach: (feed: T) => Promise<void>,
) {
  const info = await manager.attach(provider);
  const feed = await open(info.endpoint, info.targetId, info.page);
  let closing: Promise<void> | undefined;
  feed.close = () =>
    (closing ??= (async () => {
      try {
        await manager.saveEvidence(provider);
      } finally {
        await detach(feed);
      }
    })());
  return Object.assign(feed, {
    isCurrent: () => !closing && manager.isCurrent(provider, info.page),
  });
}
