import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Settings } from "../../config/configuration.js";

const cleaned = new Set<string>();

export async function saveRawCapture(
  settings: Settings,
  provider: string,
  label: string,
  value: unknown,
) {
  if (!settings.rawCaptureEnabled) return;
  const directory = join(settings.rawCaptureDir, provider);
  await mkdir(directory, { recursive: true });
  if (!cleaned.has(directory)) {
    await removeExpiredRaw(directory, settings.rawCaptureRetentionHours);
    cleaned.add(directory);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = label.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = join(directory, `${stamp}-${safe}`);
  await writeFile(
    path,
    value instanceof Uint8Array ? value : JSON.stringify(value, null, 2),
    { mode: 0o600 },
  );
}

export async function removeExpiredRaw(
  directory: string,
  retentionHours: number,
  now = Date.now(),
) {
  const cutoff = now - retentionHours * 60 * 60 * 1000;
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await Promise.all(
    files.map(async (file) => {
      const path = join(directory, file);
      const metadata = await stat(path);
      if (metadata.isFile() && metadata.mtimeMs < cutoff) await unlink(path);
    }),
  );
}
