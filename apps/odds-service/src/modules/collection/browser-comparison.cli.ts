import { readFile } from "node:fs/promises";
import { compareBrowserEvidence } from "../../shared/browser/browser-comparison.js";
const [headed, headless] = process.argv.slice(2);
if (!headed || !headless)
  throw Error(
    "Usage: browser:compare <headed-evidence.json> <headless-evidence.json>",
  );
console.log(
  JSON.stringify(
    compareBrowserEvidence(
      JSON.parse(await readFile(headed, "utf8")),
      JSON.parse(await readFile(headless, "utf8")),
    ),
    null,
    2,
  ),
);
