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

test("LoL 9z aliases match only the two explicit team variants", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const variants = [
    { provider: "bet365" as const, teamA: "9z", eventId: "9z-bet365" },
    {
      provider: "betano" as const,
      teamA: "9z Globant",
      eventId: "9z-betano",
    },
    {
      provider: "superbet" as const,
      teamA: "9z Team",
      eventId: "9z-superbet",
    },
  ];
  const events = variants.map(({ provider, teamA, eventId }) => ({
    ...structuredClone(base),
    provider,
    eventId,
    esport: "lol" as const,
    teamA,
    teamB: "Opponent",
    rawTeamA: teamA,
    rawTeamB: "Opponent",
    normalizedTeamA: teamName(teamA, "lol"),
    normalizedTeamB: teamName("Opponent", "lol"),
  }));
  const result = compareAllProviders(events);

  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].canonicalEvent.teamA, "9z");
  assert.equal(result.matched[0].providers.betano.rawTeamA, "9z Globant");
  assert.equal(result.matched[0].providers.superbet.rawTeamA, "9z Team");
  assert.equal(canonicalTeamName("9z Globant", "cs2"), "9z globant");
  assert.equal(canonicalTeamName("9z Team", "valorant"), "9z team");
  assert.notEqual(canonicalTeamName("9z Academy", "lol"), "9z");
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

test("CS2 RUSH Gaming and RUSH match Gremio despite different CCT tournament labels", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-09-18T15:00:00.000Z";
  const observed = (
    provider: "superbet" | "estrelabet",
    teamA: string,
    tournament: string,
  ) => ({
    ...structuredClone(base),
    provider,
    eventId: `${provider}:rush-gremio`,
    esport: "cs2" as const,
    teamA,
    teamB: "Gremio",
    rawTeamA: teamA,
    rawTeamB: "Gremio",
    normalizedTeamA: teamName(teamA, "cs2"),
    normalizedTeamB: teamName("Gremio", "cs2"),
    tournament,
    startsAt,
    status: "scheduled" as const,
  });
  const left = observed(
    "superbet",
    "RUSH Gaming",
    "CCT South America 2026 Challengers 3",
  );
  const right = observed("estrelabet", "RUSH", "CCT Challengers - SA");
  const result = compareAllProviders([left, right]);

  assert.equal(canonicalTeamName("RUSH Gaming", "cs2"), "rush");
  assert.equal(canonicalTeamName("RUSH", "cs2"), "rush");
  assert.equal(canonicalTeamName("RUSH Gaming", "lol"), "rush gaming");
  assert.notEqual(canonicalTeamName("RUSH Academy", "cs2"), "rush");
  assert.equal(left.normalizedTeamA, "rush gaming");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamA, "rush");
  assert.equal(result.matched[0].canonicalEvent.teamB, "gremio");
  assert.equal(result.matched[0].providers.superbet.rawTeamA, "RUSH Gaming");
  assert.equal(result.matched[0].providers.estrelabet.rawTeamA, "RUSH");
  assert.equal(result.matched[0].confidence, 0.9);
  assert.equal(result.matched[0].evidence.sameCompetitionAlias, false);
  assert.equal(
    compareAllProviders([
      left,
      { ...right, startsAt: "2026-09-18T15:01:00.000Z" },
    ]).matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([left, { ...right, esport: "lol" as const }]).matched
      .length,
    0,
  );
  assert.equal(
    compareAllProviders([left, { ...right, provider: "superbet" as const }])
      .matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([left, right, { ...right, eventId: "another-rush" }])
      .matched.length,
    0,
  );
});

test("Valorant team aliases match FENNEL GC with FENNEL (F) and preserve raw names", async () => {
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
    provider: "blaze" as const,
    eventId: "geng-gc-fennel-gc",
    esport: "valorant" as const,
    teamA: "Gen.G GC",
    teamB: "FENNEL GC",
    rawTeamA: "Gen.G GC",
    rawTeamB: "FENNEL GC",
    normalizedTeamA: teamName("Gen.G GC", "valorant"),
    normalizedTeamB: teamName("FENNEL GC", "valorant"),
    startsAt,
  };
  const right = {
    ...structuredClone(base),
    provider: "estrelabet" as const,
    eventId: "geng-gc-fennel-f",
    esport: "valorant" as const,
    teamA: "Gen.G GC",
    teamB: "FENNEL (F)",
    rawTeamA: "Gen.G GC",
    rawTeamB: "FENNEL (F)",
    normalizedTeamA: teamName("Gen.G GC", "valorant"),
    normalizedTeamB: teamName("FENNEL (F)", "valorant"),
    startsAt,
  };

  const result = compareAllProviders([left, right]);

  assert.equal(canonicalTeamName("FENNEL GC", "valorant"), "fennel gc");
  assert.equal(canonicalTeamName("FENNEL (F)", "valorant"), "fennel gc");
  assert.notEqual(
    canonicalTeamName("FENNEL (F)", "cs2"),
    canonicalTeamName("FENNEL GC", "cs2"),
  );
  assert.equal(right.normalizedTeamB, "fennel f");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamB, "fennel gc");
  assert.equal(result.matched[0].providers.blaze.rawTeamB, "FENNEL GC");
  assert.equal(result.matched[0].providers.estrelabet.rawTeamB, "FENNEL (F)");
});

test("CS2 team aliases match Nemiga Gaming vs Team 33 with Nemiga vs 33", async () => {
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
    provider: "superbet" as const,
    eventId: "nemiga-gaming-team-33",
    teamA: "Nemiga Gaming",
    teamB: "Team 33",
    rawTeamA: "Nemiga Gaming",
    rawTeamB: "Team 33",
    normalizedTeamA: teamName("Nemiga Gaming", "cs2"),
    normalizedTeamB: teamName("Team 33", "cs2"),
    startsAt,
  };
  const right = {
    ...structuredClone(base),
    provider: "estrelabet" as const,
    eventId: "nemiga-33",
    teamA: "Nemiga",
    teamB: "33",
    rawTeamA: "Nemiga",
    rawTeamB: "33",
    normalizedTeamA: teamName("Nemiga", "cs2"),
    normalizedTeamB: teamName("33", "cs2"),
    startsAt,
  };

  const result = compareAllProviders([left, right]);

  assert.equal(canonicalTeamName("Nemiga Gaming", "cs2"), "nemiga");
  assert.equal(canonicalTeamName("Nemiga", "cs2"), "nemiga");
  assert.equal(canonicalTeamName("Team 33", "cs2"), "team 33");
  assert.equal(canonicalTeamName("33", "cs2"), "team 33");
  assert.notEqual(
    canonicalTeamName("33", "valorant"),
    canonicalTeamName("Team 33", "valorant"),
  );
  assert.equal(left.normalizedTeamA, "nemiga gaming");
  assert.equal(right.normalizedTeamB, "33");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.esport, "cs2");
  assert.equal(result.matched[0].canonicalEvent.teamA, "nemiga");
  assert.equal(result.matched[0].canonicalEvent.teamB, "team 33");
  assert.equal(result.matched[0].canonicalEvent.startsAt, startsAt);
  assert.equal(result.matched[0].providers.superbet.rawTeamA, "Nemiga Gaming");
  assert.equal(result.matched[0].providers.superbet.rawTeamB, "Team 33");
  assert.equal(result.matched[0].providers.estrelabet.rawTeamA, "Nemiga");
  assert.equal(result.matched[0].providers.estrelabet.rawTeamB, "33");
});

test("CS2 team aliases match Team 33 vs L&G with 33 vs Leo Team", async () => {
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
    provider: "superbet" as const,
    eventId: "team-33-l-and-g",
    teamA: "Team 33",
    teamB: "L&G",
    rawTeamA: "Team 33",
    rawTeamB: "L&G",
    normalizedTeamA: teamName("Team 33", "cs2"),
    normalizedTeamB: teamName("L&G", "cs2"),
    startsAt,
  };
  const right = {
    ...structuredClone(base),
    provider: "blaze" as const,
    eventId: "33-leo-team",
    teamA: "33",
    teamB: "Leo Team",
    rawTeamA: "33",
    rawTeamB: "Leo Team",
    normalizedTeamA: teamName("33", "cs2"),
    normalizedTeamB: teamName("Leo Team", "cs2"),
    startsAt,
  };

  const result = compareAllProviders([left, right]);

  assert.equal(canonicalTeamName("Team 33", "cs2"), "team 33");
  assert.equal(canonicalTeamName("33", "cs2"), "team 33");
  assert.equal(canonicalTeamName("L&G", "cs2"), "leo team");
  assert.equal(canonicalTeamName("Leo Team", "cs2"), "leo team");
  assert.notEqual(
    canonicalTeamName("L&G", "valorant"),
    canonicalTeamName("Leo Team", "valorant"),
  );
  assert.equal(left.normalizedTeamB, "l g");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamA, "team 33");
  assert.equal(result.matched[0].canonicalEvent.teamB, "leo team");
  assert.equal(result.matched[0].canonicalEvent.startsAt, startsAt);
  assert.equal(result.matched[0].providers.superbet.rawTeamA, "Team 33");
  assert.equal(result.matched[0].providers.superbet.rawTeamB, "L&G");
  assert.equal(result.matched[0].providers.blaze.rawTeamA, "33");
  assert.equal(result.matched[0].providers.blaze.rawTeamB, "Leo Team");
});

test("CS2 team aliases match BAKS with BakS eSports across tournament variants", async () => {
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
    eventId: "baks-cybershoke",
    teamA: "BAKS",
    teamB: "CYBERSHOKE",
    rawTeamA: "BAKS",
    rawTeamB: "CYBERSHOKE",
    normalizedTeamA: teamName("BAKS", "cs2"),
    normalizedTeamB: teamName("CYBERSHOKE", "cs2"),
    tournament: "CIS LAN Championship",
    startsAt,
  };
  const right = {
    ...structuredClone(base),
    provider: "betano" as const,
    eventId: "baks-esports-cybershoke",
    teamA: "BakS eSports",
    teamB: "CYBERSHOKE",
    rawTeamA: "BakS eSports",
    rawTeamB: "CYBERSHOKE",
    normalizedTeamA: teamName("BakS eSports", "cs2"),
    normalizedTeamB: teamName("CYBERSHOKE", "cs2"),
    tournament: "CIS LAN Championship 7",
    startsAt,
  };

  const result = compareAllProviders([left, right]);

  assert.equal(canonicalTeamName("BAKS", "cs2"), "baks");
  assert.equal(canonicalTeamName("BakS eSports", "cs2"), "baks");
  assert.notEqual(
    canonicalTeamName("BakS eSports", "valorant"),
    canonicalTeamName("BAKS", "valorant"),
  );
  assert.equal(right.normalizedTeamA, "baks esports");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamA, "baks");
  assert.equal(result.matched[0].canonicalEvent.teamB, "cybershoke");
  assert.equal(result.matched[0].canonicalEvent.startsAt, startsAt);
  assert.equal(result.matched[0].confidence, 0.9);
  assert.equal(result.matched[0].evidence.sameCompetitionAlias, false);
  assert.equal(result.matched[0].providers.bet365.rawTeamA, "BAKS");
  assert.equal(result.matched[0].providers.betano.rawTeamA, "BakS eSports");
});

test("CS2 aliases match Astral eSports vs Rune Eaters Esports despite tournament variants", async () => {
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
    provider: "superbet" as const,
    eventId: "astral-esports-rune-eaters-esports",
    teamA: "Astral eSports",
    teamB: "Rune Eaters Esports",
    rawTeamA: "Astral eSports",
    rawTeamB: "Rune Eaters Esports",
    normalizedTeamA: teamName("Astral eSports", "cs2"),
    normalizedTeamB: teamName("Rune Eaters Esports", "cs2"),
    tournament: "Ranked Episode 5: Open Qualifier",
    startsAt,
  };
  const right = {
    ...structuredClone(base),
    provider: "blaze" as const,
    eventId: "astral-rune-eaters",
    teamA: "ASTRAL",
    teamB: "Rune Eaters",
    rawTeamA: "ASTRAL",
    rawTeamB: "Rune Eaters",
    normalizedTeamA: teamName("ASTRAL", "cs2"),
    normalizedTeamB: teamName("Rune Eaters", "cs2"),
    tournament: "Stake Ranked",
    startsAt,
  };

  const result = compareAllProviders([left, right]);

  assert.equal(canonicalTeamName("Astral eSports", "cs2"), "astral");
  assert.equal(canonicalTeamName("Rune Eaters Esports", "cs2"), "rune eaters");
  assert.notEqual(
    canonicalTeamName("Astral eSports", "valorant"),
    canonicalTeamName("ASTRAL", "valorant"),
  );
  assert.equal(left.normalizedTeamA, "astral esports");
  assert.equal(left.normalizedTeamB, "rune eaters esports");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamA, "astral");
  assert.equal(result.matched[0].canonicalEvent.teamB, "rune eaters");
  assert.equal(result.matched[0].canonicalEvent.startsAt, startsAt);
  assert.equal(result.matched[0].confidence, 0.9);
  assert.equal(result.matched[0].evidence.sameCompetitionAlias, false);
  assert.equal(result.matched[0].providers.superbet.rawTeamA, "Astral eSports");
  assert.equal(
    result.matched[0].providers.superbet.rawTeamB,
    "Rune Eaters Esports",
  );
  assert.equal(result.matched[0].providers.blaze.rawTeamA, "ASTRAL");
  assert.equal(result.matched[0].providers.blaze.rawTeamB, "Rune Eaters");
});

test("CS2 aliases match Team Vitality vs magic with Vitality vs Magic despite tournament variants", async () => {
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
    provider: "superbet" as const,
    eventId: "team-vitality-magic",
    teamA: "Team Vitality",
    teamB: "magic",
    rawTeamA: "Team Vitality",
    rawTeamB: "magic",
    normalizedTeamA: teamName("Team Vitality", "cs2"),
    normalizedTeamB: teamName("magic", "cs2"),
    tournament: "StarLadder StarSeries Fall 2026",
    startsAt,
  };
  const right = {
    ...structuredClone(base),
    provider: "blaze" as const,
    eventId: "vitality-magic",
    teamA: "Vitality",
    teamB: "Magic",
    rawTeamA: "Vitality",
    rawTeamB: "Magic",
    normalizedTeamA: teamName("Vitality", "cs2"),
    normalizedTeamB: teamName("Magic", "cs2"),
    tournament: "StarSeries",
    startsAt,
  };

  const result = compareAllProviders([left, right]);

  assert.equal(canonicalTeamName("Team Vitality", "cs2"), "vitality");
  assert.equal(canonicalTeamName("Vitality", "cs2"), "vitality");
  assert.equal(canonicalTeamName("magic", "cs2"), "magic");
  assert.equal(canonicalTeamName("Magic", "cs2"), "magic");
  assert.notEqual(
    canonicalTeamName("Team Vitality", "valorant"),
    canonicalTeamName("Vitality", "valorant"),
  );
  assert.equal(left.normalizedTeamA, "team vitality");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamA, "vitality");
  assert.equal(result.matched[0].canonicalEvent.teamB, "magic");
  assert.equal(result.matched[0].canonicalEvent.startsAt, startsAt);
  assert.equal(result.matched[0].confidence, 0.9);
  assert.equal(result.matched[0].evidence.sameCompetitionAlias, false);
  assert.equal(result.matched[0].providers.superbet.rawTeamA, "Team Vitality");
  assert.equal(result.matched[0].providers.superbet.rawTeamB, "magic");
  assert.equal(result.matched[0].providers.blaze.rawTeamA, "Vitality");
  assert.equal(result.matched[0].providers.blaze.rawTeamB, "Magic");
});

test("CS2 aliases match FURIA with FURIA Esports despite StarSeries tournament variants", async () => {
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
    provider: "superbet" as const,
    eventId: "furia-mibr",
    teamA: "FURIA",
    teamB: "MIBR",
    rawTeamA: "FURIA",
    rawTeamB: "MIBR",
    normalizedTeamA: teamName("FURIA", "cs2"),
    normalizedTeamB: teamName("MIBR", "cs2"),
    tournament: "StarSeries",
    startsAt,
  };
  const right = {
    ...structuredClone(base),
    provider: "blaze" as const,
    eventId: "furia-esports-mibr",
    teamA: "FURIA Esports",
    teamB: "MIBR",
    rawTeamA: "FURIA Esports",
    rawTeamB: "MIBR",
    normalizedTeamA: teamName("FURIA Esports", "cs2"),
    normalizedTeamB: teamName("MIBR", "cs2"),
    tournament: "StarLadder StarSeries Fall 2026",
    startsAt,
  };

  const result = compareAllProviders([left, right]);

  assert.equal(canonicalTeamName("FURIA", "cs2"), "furia");
  assert.equal(canonicalTeamName("FURIA Esports", "cs2"), "furia");
  assert.notEqual(
    canonicalTeamName("FURIA Esports", "valorant"),
    canonicalTeamName("FURIA", "valorant"),
  );
  assert.equal(right.normalizedTeamA, "furia esports");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamA, "furia");
  assert.equal(result.matched[0].canonicalEvent.teamB, "mibr");
  assert.equal(result.matched[0].canonicalEvent.startsAt, startsAt);
  assert.equal(result.matched[0].confidence, 0.9);
  assert.equal(result.matched[0].evidence.sameCompetitionAlias, false);
  assert.equal(result.matched[0].providers.superbet.rawTeamA, "FURIA");
  assert.equal(result.matched[0].providers.superbet.rawTeamB, "MIBR");
  assert.equal(result.matched[0].providers.blaze.rawTeamA, "FURIA Esports");
  assert.equal(result.matched[0].providers.blaze.rawTeamB, "MIBR");
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
