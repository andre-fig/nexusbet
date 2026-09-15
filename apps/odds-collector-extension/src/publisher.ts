import { enqueue, oldest, remove } from "./outbox.js";
import { toWire } from "./publication.js";
import type { PersistencePublication } from "../../odds-service/src/shared/interfaces/persistence-port.interface.js";

interface PrivateConfig {
  serverUrl: string;
  token: string;
}

let cached: Promise<PrivateConfig | null> | undefined;
let flushing: Promise<void> | undefined;
let preview = false;

export function setPreviewMode(enabled: boolean) {
  preview = enabled;
}

export function config() {
  const current = (cached ??= (async () => {
    const response = await fetch(
      chrome.runtime.getURL("private-config.json"),
    ).catch(() => null);
    if (!response?.ok) return null;
    const value = (await response.json()) as PrivateConfig;
    const url = new URL(value.serverUrl);
    if (
      url.origin !== "https://odds-service-production-f25c.up.railway.app" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      typeof value.token !== "string" ||
      value.token.trim().length < 32
    )
      throw Error("Invalid private collector configuration");
    return { ...value, serverUrl: url.origin + "/" };
  })());
  return current.then((value) => {
    if (!value && cached === current) cached = undefined;
    return value;
  });
}

export async function publish(publication: PersistencePublication) {
  await queue(publication);
  await flush();
}

export async function queue(publication: PersistencePublication) {
  const payload = toWire(publication);
  if (!preview) await enqueue(payload);
}

export function flush(): Promise<void> {
  if (preview) return Promise.resolve();
  return (flushing ??= flushUnlocked().finally(() => {
    flushing = undefined;
  }));
}

async function flushUnlocked() {
  const settings = await config();
  if (!settings) return;
  for (let i = 0; i < 20; i++) {
    const item = await oldest();
    if (!item) return;
    const provider = item.payload.provider;
    if (
      typeof provider !== "string" ||
      !["bet365", "betano", "superbet", "blaze", "estrelabet"].includes(
        provider,
      )
    )
      throw Error("Invalid queued provider");
    const response = await fetch(
      `${settings.serverUrl}internal/ingestion/${provider}`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${settings.token}`,
        },
        body: JSON.stringify(item.payload),
        signal: AbortSignal.timeout(30000),
      },
    );
    await response.body?.cancel();
    if (!response.ok) throw Error(`Ingestion HTTP ${response.status}`);
    await remove(item.sequence);
  }
}
