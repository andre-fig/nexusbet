import type { CollectOptions } from "../interfaces/odds-provider.interface.js";
import { saveJson } from "./files.js";
/** Stop the caller promptly; the provider closes its owned transport before releasing its lock. */
export async function collectionStep<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  let listener: () => void = () => {};
  const abort = new Promise<never>((_, reject) => {
    listener = () => reject(signal.reason ?? new Error("Aborted"));
    signal.addEventListener("abort", listener, { once: true });
    if (signal.aborted) listener();
  });
  try {
    return await Promise.race([operation, abort]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}
export async function publishCapture(
  options: CollectOptions,
  valueOrLegacyPath: unknown,
  legacyValue?: unknown,
) {
  options.signal?.throwIfAborted();
  const value = legacyValue === undefined ? valueOrLegacyPath : legacyValue;
  const publish = options.publish
    ? () => options.publish!(value)
    : legacyValue !== undefined && typeof valueOrLegacyPath === "string"
      ? () => saveJson(valueOrLegacyPath, value)
      : undefined;
  if (!publish) throw Error("Direct publication target unavailable");
  if (options.publications) {
    options.publications.push(publish);
    return;
  }
  await publish();
}
