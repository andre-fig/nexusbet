import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);

test("identical collector bundles retain their reload ID", async () => {
  const build = () => run(process.execPath, [join(root, "build.mjs")]);
  await build();
  const first = (
    await readFile(join(root, "dist", "build-id.txt"), "utf8")
  ).trim();
  await build();
  const second = (
    await readFile(join(root, "dist", "build-id.txt"), "utf8")
  ).trim();
  assert.match(first, /^[a-f0-9]{20}$/);
  assert.equal(second, first);
});
