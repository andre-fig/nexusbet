import { readFile } from "node:fs/promises";
import { parseCapture } from "../parsers/list.parser.js";
const file = process.argv[2];
if (!file) throw new Error("Usage: npm run normalize -- capture.json");
console.log(
  JSON.stringify(
    parseCapture(JSON.parse(await readFile(file, "utf8"))).matches,
    null,
    2,
  ),
);
