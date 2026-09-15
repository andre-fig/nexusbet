import { readFile } from "node:fs/promises";
import type { EstrelaBetCapture } from "../types/feed.js";
export async function fixture(name = "list"): Promise<EstrelaBetCapture> {
  return JSON.parse(
    await readFile(
      new URL(`../fixtures/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}
export const eventIds = {
  cs2: "17707439",
  lol: "17688530",
  valorant: "17708904",
};
