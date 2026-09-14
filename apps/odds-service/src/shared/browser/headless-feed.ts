import { chromium, type BrowserContext } from "playwright-core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeDebugEndpoint } from "./endpoint.js";

/** Owned, invisible Chrome. Never attaches to the user's browser or copies its profile. */
export async function openHeadlessFeed<T extends { close(): Promise<void> }>(
  open: (endpoint: string) => Promise<T>,
): Promise<T> {
  const profile = await mkdtemp(join(tmpdir(), "odds-headless-"));
  let context: BrowserContext | undefined;
  const dispose = async () => {
    try {
      await context?.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  };
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chrome",
      headless: true,
      viewport: { width: 1440, height: 1000 },
      args: [
        "--remote-debugging-port=0",
        "--remote-debugging-address=127.0.0.1",
      ],
    });
    const feed = await open(
      await nativeDebugEndpoint(join(profile, "DevToolsActivePort")),
    );
    const close = feed.close.bind(feed);
    let closing: Promise<void> | undefined;
    feed.close = () =>
      (closing ??= (async () => {
        try {
          await close();
        } finally {
          await dispose();
        }
      })());
    return feed;
  } catch (error) {
    await dispose();
    throw error;
  }
}
