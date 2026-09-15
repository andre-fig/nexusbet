import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { teamName } from "../../../shared/utils/names.js";
import { compareAllProviders, compareProviders } from "../matching.js";
import { canonicalTeamName } from "../team-aliases.js";
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
  assert.equal(canonicalTeamName("NÁVI!", "cs2"), "natus vincere");
  assert.equal(teamName("NRG Esports", "cs2"), "nrg esports");
  assert.equal(canonicalTeamName("NRG Esports", "cs2"), "nrg");
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
  const differentTournament = compareProviders(
    [one],
    [{ ...other, tournament: "Other season" }],
  ).matched[0];
  assert.equal(differentTournament.confidence, 0.9);
  assert.equal(differentTournament.evidence.sameCompetitionAlias, false);
});

test("matching regressions normalize team names, ignore side order and do not veto different tournaments", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const cases = [
    {
      name: "WW Team vs Ww Team",
      left: { teamA: "WW Team", teamB: "Opponent" },
      right: { teamA: "  Ww   Team!! ", teamB: "Opponent" },
      tournaments: ["Same League", "Same League"],
      confidence: 1,
    },
    {
      name: "Top Esports vs Invictus Gaming in reversed order",
      left: { teamA: "Top Esports", teamB: "Invictus Gaming" },
      right: { teamA: "Invictus Gaming", teamB: "Top Esports" },
      tournaments: ["LPL", "LPL"],
      confidence: 1,
    },
    {
      name: "Ranked Episode 5: Open Qualifier vs Stake Ranked",
      left: { teamA: "Alpha", teamB: "Bravo" },
      right: { teamA: "Alpha", teamB: "Bravo" },
      tournaments: ["Ranked Episode 5: Open Qualifier", "Stake Ranked"],
      confidence: 0.9,
    },
    {
      name: "Logitech G Play Connect vs G Play Connect 2026",
      left: { teamA: "Charlie", teamB: "Delta" },
      right: { teamA: "Charlie", teamB: "Delta" },
      tournaments: ["Logitech G Play Connect", "G Play Connect 2026"],
      confidence: 0.9,
    },
  ] as const;

  for (const regression of cases) {
    const left = {
      ...structuredClone(base),
      ...regression.left,
      provider: "bet365" as const,
      eventId: regression.name + "-bet365",
      tournament: regression.tournaments[0],
      rawTeamA: regression.left.teamA,
      rawTeamB: regression.left.teamB,
      normalizedTeamA: teamName(regression.left.teamA, base.esport),
      normalizedTeamB: teamName(regression.left.teamB, base.esport),
    };
    const right = {
      ...structuredClone(base),
      ...regression.right,
      provider: "betano" as const,
      eventId: regression.name + "-betano",
      tournament: regression.tournaments[1],
      rawTeamA: regression.right.teamA,
      rawTeamB: regression.right.teamB,
      normalizedTeamA: teamName(regression.right.teamA, base.esport),
      normalizedTeamB: teamName(regression.right.teamB, base.esport),
    };
    const result = compareAllProviders([left, right]);
    assert.equal(result.matched.length, 1, regression.name);
    assert.equal(result.unmatched.length, 0, regression.name);
    assert.equal(result.matched[0].confidence, regression.confidence);
  }
});

test("LoL team aliases match KOI with Movistar KOI and preserve raw names", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-09-18T15:00:00.000Z";
  const left = {
    ...structuredClone(base),
    provider: "bet365" as const,
    eventId: "navi-koi",
    esport: "lol" as const,
    teamA: "Natus Vincere",
    teamB: "KOI",
    rawTeamA: "Natus Vincere",
    rawTeamB: "KOI",
    normalizedTeamA: teamName("Natus Vincere", "lol"),
    normalizedTeamB: teamName("KOI", "lol"),
    startsAt,
  };
  const right = {
    ...structuredClone(base),
    provider: "betano" as const,
    eventId: "navi-movistar-koi",
    esport: "lol" as const,
    teamA: "Natus Vincere",
    teamB: "Movistar KOI",
    rawTeamA: "Natus Vincere",
    rawTeamB: "Movistar KOI",
    normalizedTeamA: teamName("Natus Vincere", "lol"),
    normalizedTeamB: teamName("Movistar KOI", "lol"),
    startsAt,
  };

  const result = compareAllProviders([left, right]);

  assert.equal(canonicalTeamName("KOI", "lol"), "koi");
  assert.equal(canonicalTeamName("Movistar KOI", "lol"), "koi");
  assert.equal(right.normalizedTeamB, "movistar koi");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamB, "koi");
  assert.equal(result.matched[0].providers.bet365.rawTeamB, "KOI");
  assert.equal(result.matched[0].providers.betano.rawTeamB, "Movistar KOI");
});

test("CS2 team aliases match Brute with Team Brute and preserve raw names", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-09-18T15:00:00.000Z";
  const left = {
    ...structuredClone(base),
    provider: "bet365" as const,
    eventId: "brute-g2-ares",
    teamA: "Brute",
    teamB: "G2 Ares",
    rawTeamA: "Brute",
    rawTeamB: "G2 Ares",
    normalizedTeamA: teamName("Brute", "cs2"),
    normalizedTeamB: teamName("G2 Ares", "cs2"),
    startsAt,
  };
  const right = {
    ...structuredClone(base),
    provider: "betano" as const,
    eventId: "team-brute-g2-ares",
    teamA: "Team Brute",
    teamB: "G2 Ares",
    rawTeamA: "Team Brute",
    rawTeamB: "G2 Ares",
    normalizedTeamA: teamName("Team Brute", "cs2"),
    normalizedTeamB: teamName("G2 Ares", "cs2"),
    startsAt,
  };

  const result = compareAllProviders([left, right]);

  assert.equal(canonicalTeamName("Brute", "cs2"), "brute");
  assert.equal(canonicalTeamName("Team Brute", "cs2"), "brute");
  assert.notEqual(
    canonicalTeamName("Team Liquid", "cs2"),
    canonicalTeamName("Liquid", "cs2"),
  );
  assert.notEqual(
    canonicalTeamName("Example Esports", "cs2"),
    canonicalTeamName("Example", "cs2"),
  );
  assert.notEqual(
    canonicalTeamName("Team Brute", "lol"),
    canonicalTeamName("Brute", "lol"),
  );
  assert.equal(right.normalizedTeamA, "team brute");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamA, "brute");
  assert.equal(result.matched[0].providers.bet365.rawTeamA, "Brute");
  assert.equal(result.matched[0].providers.betano.rawTeamA, "Team Brute");
});

test("matching forms complete groups with three, four or five providers without a fixed quorum", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const providers = [
    "bet365",
    "betano",
    "superbet",
    "blaze",
    "estrelabet",
  ] as const;
  for (const count of [3, 4, 5]) {
    const events = providers.slice(0, count).map((provider, index) => ({
      ...structuredClone(base),
      provider,
      eventId: `${provider}-${index}`,
    }));
    const result = compareAllProviders(events);
    assert.equal(result.matched.length, 1);
    assert.equal(Object.keys(result.matched[0].providers).length, count);
    assert.equal(result.unmatched.length, 0);
  }
});
