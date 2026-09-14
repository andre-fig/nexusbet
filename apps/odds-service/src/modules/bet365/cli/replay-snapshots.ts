import { readFile, mkdtemp, copyFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../persistence/list.store.js";
import type { Capture } from "../types/model.js";
const output = process.argv[2];
if (!output)
  throw Error("Provide an output directory for historical fixture replay");
const captures: Capture[] = [];
for (const game of ["cs2", "lol", "valorant"])
  for (const suffix of ["", "-later"])
    captures.push(
      JSON.parse(
        await readFile(
          new URL(`../fixtures/${game}${suffix}.json`, import.meta.url),
          "utf8",
        ),
      ),
    );
captures.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
const dir = await mkdtemp(join(tmpdir(), "bet365-replay-"));
try {
  const store = new Store(dir);
  await store.load();
  for (const c of captures) await store.ingest(c);
  await mkdir(resolve(output), { recursive: true });
  await copyFile(
    join(dir, "snapshots.ndjson"),
    join(resolve(output), "historical-replay.ndjson"),
  );
  console.log(
    JSON.stringify({
      historicalReplay: true,
      captures: captures.length,
      latestMatches: store.state.matches.length,
      output: resolve(output),
    }),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
