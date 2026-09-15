import { build } from "esbuild";
import { mkdir, copyFile, writeFile, rm, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const outdir = join(root, "dist");
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: [join(root, "src", "background.ts")],
  outfile: join(outdir, "background.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  sourcemap: false,
  legalComments: "none",
});
await copyFile(join(root, "manifest.json"), join(outdir, "manifest.json"));
await copyFile(join(root, "popup.html"), join(outdir, "popup.html"));
await copyFile(join(root, "popup.js"), join(outdir, "popup.js"));
try {
  await copyFile(
    join(root, "private-config.json"),
    join(outdir, "private-config.json"),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  await rm(join(outdir, "private-config.json"), { force: true });
}
const hash = createHash("sha256");
for (const name of [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
]) {
  hash.update(name);
  hash.update(await readFile(join(outdir, name)));
}
await writeFile(join(outdir, "build-id.txt"), hash.digest("hex").slice(0, 20));
