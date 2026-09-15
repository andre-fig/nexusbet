import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configuration } from "../../../config/configuration.js";
import {
  removeExpiredRaw,
  saveRawCapture,
} from "../../../shared/utils/raw-capture.js";
import { IngestionCommitService } from "../ingestion-commit.service.js";

test("raw capture is off by default and enabled capture has bounded retention", async () => {
  const root = await mkdtemp(join(tmpdir(), "direct-raw-"));
  try {
    const settings = {
      ...configuration().settings,
      rawCaptureDir: root,
      rawCaptureEnabled: false,
      rawCaptureRetentionHours: 24,
    };
    await saveRawCapture(settings, "superbet", "listing.json", { ok: true });
    await assert.rejects(access(join(root, "superbet")));

    settings.rawCaptureEnabled = true;
    const directory = join(root, "superbet");
    await mkdir(directory, { recursive: true });
    const expired = join(directory, "expired.json");
    await writeFile(expired, "{}");
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(expired, old, old);
    await saveRawCapture(settings, "superbet", "listing.json", { ok: true });
    const files = await readdir(directory);
    assert.equal(files.includes("expired.json"), false);
    assert.equal(files.length, 1);

    await removeExpiredRaw(directory, 24, Date.now() + 25 * 60 * 60 * 1000);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("direct commit rejects aborted/superseded runs and serializes a provider", async () => {
  const service = new IngestionCommitService();
  const old = service.begin("superbet"),
    current = service.begin("superbet"),
    signal = new AbortController().signal;
  let published = false;
  await assert.rejects(
    service.commit(old, signal, () => {}, [
      async () => void (published = true),
    ]),
    /Superseded/,
  );
  assert.equal(published, false);

  const order: string[] = [];
  let release!: () => void;
  const first = service.commit(current, signal, () => {}, [
    async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push("first:end");
    },
  ]);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const second = service.commit(current, signal, () => {}, [
    async () => void order.push("second"),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first:start"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second"]);

  const aborted = new AbortController();
  aborted.abort(new Error("timeout"));
  await assert.rejects(
    service.commit(current, aborted.signal, () => {}, [
      async () => void (published = true),
    ]),
    /timeout/,
  );
});
