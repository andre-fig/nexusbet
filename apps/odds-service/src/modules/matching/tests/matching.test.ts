import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { teamName } from "../../../shared/utils/names.js";
import { compareProviders } from "../matching.js";
import { normalizedBet365 } from "../../bet365/mappers/bet365.mapper.js";
import { parseCapture } from "../../bet365/parsers/list.parser.js";
import {
  parseListing,
  type BetanoCapture,
} from "../../betano/parsers/feed.parser.js";
async function fixture(name: string): Promise<BetanoCapture> {
  return JSON.parse(
    await readFile(
      new URL("../../betano/fixtures/" + name + ".json", import.meta.url),
      "utf8",
    ),
  );
}
test("Conservative cross-provider matching: aliases, reversed sides, ambiguities and date conflicts", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const p = parseCapture(raw);
  const a = normalizedBet365(p.matches, p.provenance);
  const b = parseListing(await fixture("cs2-list"), "cs2");
  const result = compareProviders(a, b);
  assert.ok(result.matched.length >= 2);
  assert.equal(teamName("NÁVI!", "cs2"), "natus vincere");
  assert.equal(teamName("NRG Esports", "cs2"), "nrg");
  assert.notEqual(teamName("T1 Academy", "lol"), teamName("T1", "lol"));
  const one = a.find((e) => e.teamA === "MOUZ")!;
  const other = b.find((e) => e.teamA === "MOUZ")!;
  const reversed = { ...other, teamA: other.teamB, teamB: other.teamA };
  assert.equal(
    compareProviders([one], [reversed]).matched[0].providers.betano.reversed,
    true,
  );
  assert.equal(
    compareProviders([one], [other, { ...other, eventId: "999" }]).matched
      .length,
    0,
  );
  assert.equal(
    compareProviders([one, { ...one, eventId: "duplicate" }], [other]).matched
      .length,
    0,
  );
  assert.equal(
    compareProviders(
      [one],
      [
        {
          ...other,
          startsAt: new Date(
            Date.parse(other.startsAt) + 86400000,
          ).toISOString(),
        },
      ],
    ).matched.length,
    0,
  );
  assert.equal(
    compareProviders([one], [{ ...other, tournament: "Other season" }]).matched
      .length,
    0,
  );
});
