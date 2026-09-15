import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { teamName, tournamentName } from "../../../shared/utils/names.js";
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

test("matching keys remove only safe team prefixes and suffixes before semantic aliases", () => {
  const examples = [
    ["Team Brute", "brute"],
    ["Brute", "brute"],
    ["Team Vitality", "vitality"],
    ["Vitality", "vitality"],
    ["33 Team", "33"],
    ["Team 33", "33"],
    ["Nemiga Gaming", "nemiga"],
    ["Nemiga", "nemiga"],
    ["RUSH", "rush"],
    ["FURIA Esports", "furia"],
    ["Astral eSports", "astral"],
    ["Rune Eaters Esports", "rune eaters"],
    ["BAKS Esports", "baks"],
    ["RUSH Gaming", "rush"],
    ["Nexus Gaming", "nexus"],
    ["NRG Esports", "nrg"],
    ["Team QUAZAR", "quazar"],
    ["T1 Esports", "t1"],
    ["Téam  Brute E-Sports!", "brute"],
    ["FURIA e-sports", "furia"],
    ["Nexus Esport", "nexus"],
  ] as const;
  for (const [name, expected] of examples)
    assert.equal(canonicalTeamName(name, "cs2"), expected, name);
  assert.equal(canonicalTeamName("T1 Esports", "valorant"), "t1");
  assert.equal(teamName("Nexus Gaming", "cs2"), "nexus gaming");
  assert.equal(canonicalTeamName("Team NÁVI Esports", "cs2"), "natus vincere");
  assert.equal(canonicalTeamName("L&G", "cs2"), "leo");
  assert.equal(canonicalTeamName("Team 33", "cs2"), "33");
  assert.equal(canonicalTeamName("Brute Team", "cs2"), "brute");
  assert.equal(canonicalTeamName("Alpha Team Beta", "cs2"), "alpha team beta");
  assert.equal(canonicalTeamName("Movistar KOI", "lol"), "koi");
  assert.equal(canonicalTeamName("9z Globant", "lol"), "9z");
  assert.equal(canonicalTeamName("9z Team", "lol"), "9z");
  assert.equal(canonicalTeamName("FENNEL (F)", "valorant"), "fennel gc");
  for (const term of [
    "Academy",
    "Junior",
    "Young",
    "GC",
    "Female",
    "ex",
    "fe",
    "Youth",
  ])
    assert.notEqual(
      canonicalTeamName(`Nexus ${term} Gaming`, "cs2"),
      "nexus",
      term,
    );
  assert.notEqual(canonicalTeamName("ex-Nexus Gaming", "cs2"), "nexus");
  assert.notEqual(canonicalTeamName("Nexus Gaming Youth", "cs2"), "nexus");
});
test("OldMix vs EAC Extra and OldMix vs EA Copenhagen Extra are one United21 match", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const make = (
    provider: "superbet" | "blaze",
    eventId: string,
    teamB: string,
    startsAt: string,
  ) => ({
    ...structuredClone(base),
    provider,
    eventId,
    esport: "cs2" as const,
    teamA: "OldMix",
    teamB,
    rawTeamA: "OldMix",
    rawTeamB: teamB,
    normalizedTeamA: teamName("OldMix", "cs2"),
    normalizedTeamB: teamName(teamB, "cs2"),
    tournament: "United21",
    startsAt,
    status: "scheduled" as const,
  });
  // 07:30 America/Sao_Paulo is 10:30 UTC on 16 September 2026.
  const short = make(
    "superbet",
    "oldmix-eac",
    "EAC Extra",
    "2026-09-16T10:30:00.000Z",
  );
  const full = make(
    "blaze",
    "oldmix-ea-copenhagen",
    "EA Copenhagen Extra",
    "2026-09-16T10:30:00.000Z",
  );
  const result = compareAllProviders([short, full]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamB, "ea copenhagen extra");
  assert.deepEqual(result.matched[0].learnedAliases, [
    {
      esport: "cs2",
      alias: "eac extra",
      canonical: "ea copenhagen extra",
    },
  ]);
  assert.equal(
    compareAllProviders([
      short,
      { ...full, startsAt: "2026-09-16T10:32:00.000Z" },
    ]).matched.length,
    1,
  );
  assert.equal(
    compareAllProviders([short, { ...full, tournament: "Other" }]).matched
      .length,
    0,
  );
  assert.equal(
    compareAllProviders([short, { ...full, teamA: "Another" }]).matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([
      short,
      { ...full, startsAt: "2026-09-16T10:36:00.000Z" },
    ]).matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([short, full, { ...full, eventId: "other" }]).matched
      .length,
    0,
  );
});
test("Lavked vs Saint Sinners and lavked vs saint sinners are one European Pro League match", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-09-16T08:00:00.000Z"; // 05:00 America/Sao_Paulo
  const make = (
    provider: "superbet" | "blaze",
    eventId: string,
    teamA: string,
    teamB: string,
    tournament: string,
  ) => ({
    ...structuredClone(base),
    provider,
    eventId,
    esport: "cs2" as const,
    teamA,
    teamB,
    rawTeamA: teamA,
    rawTeamB: teamB,
    normalizedTeamA: teamName(teamA, "cs2"),
    normalizedTeamB: teamName(teamB, "cs2"),
    tournament,
    startsAt,
    status: "scheduled" as const,
  });
  const first = make(
    "superbet",
    "lavked-upper",
    "Lavked",
    "Saint Sinners",
    "CS2 - European Pro League",
  );
  const second = make(
    "blaze",
    "lavked-lower",
    "lavked",
    "saint sinners",
    "European Pro League",
  );
  assert.equal(tournamentName(first.tournament, "cs2"), "european pro league");
  assert.equal(tournamentName(second.tournament, "cs2"), "european pro league");
  const result = compareAllProviders([first, second]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.deepEqual(result.matched[0].canonicalEvent, {
    esport: "cs2",
    tournament: "european pro league",
    teamA: "lavked",
    teamB: "saint sinners",
    startsAt,
  });
  assert.equal(result.matched[0].confidence, 1);
  assert.equal(
    compareAllProviders([
      first,
      {
        ...second,
        teamA: " LÁVKED!! ",
        teamB: " SAINT...  SINNERS! ",
        tournament: "  cS2: Éuropean  PRO-League! ",
      },
    ]).matched.length,
    1,
  );
  assert.equal(
    compareAllProviders([first, { ...second, teamB: "Other Sinners" }]).matched
      .length,
    0,
  );
  assert.equal(
    compareAllProviders([
      first,
      { ...second, startsAt: "2026-09-16T09:00:00.000Z" },
    ]).matched.length,
    0,
  );
  assert.equal(
    tournamentName("CS2 - European Pro League Season 40", "cs2"),
    "european pro league season 40",
  );
});
test("MEIA NOITE vs Sementes do Mal and MEIA NOITE vs Semente do Mal share CCT South America Challenger", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-09-15T23:45:00.000Z"; // 20:45 America/Sao_Paulo
  const make = (
    provider: "superbet" | "estrelabet",
    eventId: string,
    teamB: string,
    tournament: string,
  ) => ({
    ...structuredClone(base),
    provider,
    eventId,
    esport: "cs2" as const,
    teamA: "MEIA NOITE",
    teamB,
    rawTeamA: "MEIA NOITE",
    rawTeamB: teamB,
    normalizedTeamA: teamName("MEIA NOITE", "cs2"),
    normalizedTeamB: teamName(teamB, "cs2"),
    tournament,
    startsAt,
    status: "scheduled" as const,
  });
  const plural = make(
    "superbet",
    "meia-noite-plural",
    "Sementes do Mal",
    "CS2 - CCT South America Challenger",
  );
  const singular = make(
    "estrelabet",
    "meia-noite-singular",
    "Semente do Mal",
    "CCT Challengers - SA",
  );
  assert.equal(
    tournamentName(plural.tournament, "cs2"),
    "cct south america challenger",
  );
  assert.equal(
    tournamentName(singular.tournament, "cs2"),
    "cct south america challenger",
  );
  const result = compareAllProviders([plural, singular]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.deepEqual(result.matched[0].canonicalEvent, {
    esport: "cs2",
    tournament: "cct south america challenger",
    teamA: "meia noite",
    teamB: "sementes do mal",
    startsAt,
  });
  assert.equal(result.matched[0].confidence, 1);
  assert.deepEqual(result.matched[0].learnedAliases, [
    {
      esport: "cs2",
      alias: "semente do mal",
      canonical: "sementes do mal",
    },
  ]);
  assert.deepEqual(result.matched[0].learnedTournamentAliases, [
    {
      esport: "cs2",
      alias: "cct challengers sa",
      canonical: "cct south america challenger",
    },
  ]);
  const reused = {
    ...singular,
    tournament: "CCT SA saved variant",
    startsAt: "2026-09-15T23:46:00.000Z",
  };
  assert.equal(compareAllProviders([plural, reused]).matched.length, 0);
  assert.equal(
    compareAllProviders(
      [plural, reused],
      [plural.provider, reused.provider],
      { cs2: { "semente do mal": "sementes do mal" } },
      { cs2: { "cct sa saved variant": "cct south america challenger" } },
    ).matched.length,
    1,
  );
  assert.equal(
    compareAllProviders([plural, { ...singular, teamA: "OTHER" }]).matched
      .length,
    0,
  );
  assert.equal(
    compareAllProviders([plural, { ...singular, teamB: "Semente do Bem" }])
      .matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([plural, { ...singular, tournament: "Other Cup" }])
      .matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([
      plural,
      { ...singular, startsAt: "2026-09-16T00:00:00.000Z" },
    ]).matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([
      plural,
      singular,
      { ...singular, eventId: "ambiguous" },
    ]).matched.length,
    0,
  );
});
test("Heroic vs Johny Speeds and heroic vs johnny speeds share Stake Pulse Beat", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-09-22T10:00:00.000Z"; // 07:00 America/Sao_Paulo
  const make = (
    provider: "superbet" | "blaze",
    eventId: string,
    teamA: string,
    teamB: string,
    tournament: string,
  ) => ({
    ...structuredClone(base),
    provider,
    eventId,
    esport: "cs2" as const,
    teamA,
    teamB,
    rawTeamA: teamA,
    rawTeamB: teamB,
    normalizedTeamA: teamName(teamA, "cs2"),
    normalizedTeamB: teamName(teamB, "cs2"),
    tournament,
    startsAt,
    status: "scheduled" as const,
  });
  const typo = make(
    "superbet",
    "heroic-johny",
    "Heroic",
    "Johny Speeds",
    "Stake Pulse Beat",
  );
  const full = make(
    "blaze",
    "heroic-johnny",
    "heroic",
    "johnny speeds",
    "pulse beat ii",
  );
  assert.equal(tournamentName(typo.tournament, "cs2"), "stake pulse beat");
  assert.equal(tournamentName(full.tournament, "cs2"), "stake pulse beat");
  const result = compareAllProviders([typo, full]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.deepEqual(result.matched[0].canonicalEvent, {
    esport: "cs2",
    tournament: "stake pulse beat",
    teamA: "heroic",
    teamB: "johnny speeds",
    startsAt,
  });
  assert.equal(result.matched[0].confidence, 1);
  assert.deepEqual(result.matched[0].learnedAliases, [
    {
      esport: "cs2",
      alias: "johny speeds",
      canonical: "johnny speeds",
    },
  ]);
  assert.deepEqual(result.matched[0].learnedTournamentAliases, [
    {
      esport: "cs2",
      alias: "pulse beat ii",
      canonical: "stake pulse beat",
    },
  ]);
  assert.equal(
    compareAllProviders([typo, { ...full, tournament: "Other Cup" }]).matched
      .length,
    0,
  );
  assert.equal(
    compareAllProviders([typo, { ...full, teamA: "Other" }]).matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([typo, { ...full, teamB: "Johnny Speedsters" }]).matched
      .length,
    0,
  );
  assert.equal(
    compareAllProviders([
      typo,
      { ...full, startsAt: "2026-09-22T10:06:00.000Z" },
    ]).matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([typo, full, { ...full, eventId: "other-johnny" }])
      .matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([
      typo,
      { ...full, startsAt: "2026-09-22T10:02:00.000Z" },
    ]).matched.length,
    1,
  );
});
test("apogee vs astral and Betclic vs ASTRAL Esports share one Pulse Beat match with full canonical names", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-09-24T10:00:00.000Z"; // 07:00 America/Sao_Paulo
  const make = (
    provider: "superbet" | "blaze",
    eventId: string,
    teamA: string,
    teamB: string,
    tournament: string,
  ) => ({
    ...structuredClone(base),
    provider,
    eventId,
    esport: "cs2" as const,
    teamA,
    teamB,
    rawTeamA: teamA,
    rawTeamB: teamB,
    normalizedTeamA: teamName(teamA, "cs2"),
    normalizedTeamB: teamName(teamB, "cs2"),
    tournament,
    startsAt,
    status: "scheduled" as const,
  });
  const apogee = make(
    "superbet",
    "apogee-astral",
    "apogee",
    "astral",
    "stake pulse beat",
  );
  const betclic = make(
    "blaze",
    "betclic-astral",
    "Betclic",
    "ASTRAL Esports",
    "Pulse Beat II",
  );
  assert.equal(canonicalTeamName("Apogee", "cs2"), "betclic apogee");
  assert.equal(canonicalTeamName("Betclic", "cs2"), "betclic apogee");
  assert.equal(
    canonicalTeamName("Betclic Apogee Esports", "cs2"),
    "betclic apogee",
  );
  assert.equal(canonicalTeamName("ASTRAL Esports", "cs2"), "astral");
  const result = compareAllProviders([apogee, betclic]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.deepEqual(result.matched[0].canonicalEvent, {
    esport: "cs2",
    tournament: "stake pulse beat",
    teamA: "Betclic Apogee Esports",
    teamB: "ASTRAL Esports",
    startsAt,
  });
  assert.equal(result.matched[0].confidence, 1);
  assert.deepEqual(result.matched[0].learnedAliases, [
    { esport: "cs2", alias: "apogee", canonical: "betclic apogee" },
    { esport: "cs2", alias: "betclic", canonical: "betclic apogee" },
  ]);
  assert.deepEqual(result.matched[0].learnedTournamentAliases, [
    { esport: "cs2", alias: "pulse beat ii", canonical: "stake pulse beat" },
  ]);
  assert.equal(
    compareAllProviders([apogee, { ...betclic, teamB: "Other" }]).matched
      .length,
    0,
  );
  assert.equal(
    compareAllProviders([
      apogee,
      { ...betclic, startsAt: "2026-09-24T10:06:00.000Z" },
    ]).matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([apogee, betclic, { ...betclic, eventId: "duplicate" }])
      .matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([
      apogee,
      { ...betclic, teamA: "Betclic Apogee Esports" },
    ]).matched.length,
    1,
  );
});
test("faze vs nemiga and FaZe Clan vs Nemiga share one StarLadder Ranked match", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-10-01T17:30:00.000Z"; // 14:30 America/Sao_Paulo
  const make = (
    provider: "superbet" | "betano",
    eventId: string,
    teamA: string,
    teamB: string,
    tournament: string,
  ) => ({
    ...structuredClone(base),
    provider,
    eventId,
    esport: "cs2" as const,
    teamA,
    teamB,
    rawTeamA: teamA,
    rawTeamB: teamB,
    normalizedTeamA: teamName(teamA, "cs2"),
    normalizedTeamB: teamName(teamB, "cs2"),
    tournament,
    startsAt,
    status: "scheduled" as const,
  });
  const short = make(
    "superbet",
    "faze-nemiga",
    "faze",
    "nemiga",
    "starladder ranked",
  );
  const full = make(
    "betano",
    "faze-clan-nemiga",
    "FaZe Clan",
    "Nemiga",
    "Stake Ranked",
  );
  assert.equal(canonicalTeamName("FaZe Clan", "cs2"), "faze");
  assert.equal(canonicalTeamName("Nova Clan", "cs2"), "nova clan");
  assert.equal(tournamentName(full.tournament, "cs2"), "starladder ranked");
  const result = compareAllProviders([short, full]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.deepEqual(result.matched[0].canonicalEvent, {
    esport: "cs2",
    tournament: "starladder ranked",
    teamA: "FaZe Clan",
    teamB: "Nemiga",
    startsAt,
  });
  assert.equal(result.matched[0].confidence, 1);
  assert.deepEqual(result.matched[0].learnedAliases, [
    { esport: "cs2", alias: "faze clan", canonical: "faze" },
  ]);
  assert.deepEqual(result.matched[0].learnedTournamentAliases, [
    { esport: "cs2", alias: "stake ranked", canonical: "starladder ranked" },
  ]);
  assert.equal(
    compareAllProviders([short, { ...full, teamB: "Other" }]).matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([short, { ...full, teamA: "Nova Clan" }]).matched
      .length,
    0,
  );
  assert.equal(
    compareAllProviders([
      short,
      { ...full, startsAt: "2026-10-01T17:36:00.000Z" },
    ]).matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([short, full, { ...full, eventId: "duplicate" }])
      .matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([
      short,
      { ...full, startsAt: "2026-10-01T17:32:00.000Z" },
    ]).matched.length,
    1,
  );
  assert.equal(
    compareAllProviders([
      short,
      {
        ...full,
        tournament: "Other Cup",
        startsAt: "2026-10-01T17:32:00.000Z",
      },
    ]).matched.length,
    0,
  );
});
test("CS2 UPGRADE vs Wraith Pcific matches UPGRADE vs Pcific Esports via a scoped alias", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-09-19T09:00:00.000Z";
  const event = (
    provider: "superbet" | "blaze",
    eventId: string,
    teamB: string,
  ) => ({
    ...structuredClone(base),
    provider,
    eventId,
    teamA: "UPGRADE",
    teamB,
    rawTeamA: "UPGRADE",
    rawTeamB: teamB,
    normalizedTeamA: teamName("UPGRADE", "cs2"),
    normalizedTeamB: teamName(teamB, "cs2"),
    startsAt,
  });
  const left = event("superbet", "upgrade-wraith-pcific", "Wraith Pcific");
  const right = event("blaze", "upgrade-pcific", "Pcific Esports");
  assert.equal(canonicalTeamName("Wraith Pcific", "cs2"), "pcific");
  assert.equal(canonicalTeamName("Pcific Esports", "cs2"), "pcific");
  assert.equal(canonicalTeamName("Wraith Pcific", "valorant"), "wraith pcific");
  assert.equal(canonicalTeamName("Wraith Other", "cs2"), "wraith other");
  const result = compareAllProviders([left, right]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamB, "pcific");
  assert.equal(result.matched[0].canonicalEvent.startsAt, startsAt);
  assert.equal(result.matched[0].providers.superbet.rawTeamB, "Wraith Pcific");
  assert.equal(result.matched[0].providers.blaze.rawTeamB, "Pcific Esports");
  assert.equal(
    compareAllProviders([
      left,
      { ...right, startsAt: "2026-09-19T10:00:00.000Z" },
    ]).matched.length,
    0,
  );
});
test("Just players vs Natus Vincere Juniors matches the singular Junior team only", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-09-19T09:00:00.000Z";
  const event = (
    provider: "bet365" | "blaze",
    eventId: string,
    teamA: string,
    teamB: string,
  ) => ({
    ...structuredClone(base),
    provider,
    eventId,
    teamA,
    teamB,
    rawTeamA: teamA,
    rawTeamB: teamB,
    normalizedTeamA: teamName(teamA, "cs2"),
    normalizedTeamB: teamName(teamB, "cs2"),
    startsAt,
  });
  const left = event(
    "bet365",
    "just-players-natus-vincere-juniors",
    "Just players",
    "Natus Vincere Juniors",
  );
  const right = event(
    "blaze",
    "just-players-natus-vincere-junior",
    "just players",
    "natus vincere junior",
  );
  assert.equal(
    canonicalTeamName("Natus Vincere Juniors", "cs2"),
    "natus vincere junior",
  );
  assert.equal(
    canonicalTeamName("Natus Vincere Junior", "cs2"),
    "natus vincere junior",
  );
  assert.equal(canonicalTeamName("Natus Vincere", "cs2"), "natus vincere");
  assert.equal(
    canonicalTeamName("Natus Juniors Academy", "cs2"),
    "natus juniors academy",
  );
  const result = compareAllProviders([left, right]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamA, "just players");
  assert.equal(result.matched[0].canonicalEvent.teamB, "natus vincere junior");
  assert.equal(result.matched[0].canonicalEvent.startsAt, startsAt);
  assert.equal(
    result.matched[0].providers.bet365.rawTeamB,
    "Natus Vincere Juniors",
  );
  assert.equal(
    result.matched[0].providers.blaze.rawTeamB,
    "natus vincere junior",
  );
  assert.equal(
    compareAllProviders([
      left,
      event("blaze", "just-players-main-navi", "just players", "Natus Vincere"),
    ]).matched.length,
    0,
  );
});

test("ex-RUSTEC vs Nexus Gaming matches ex-RUSTEC vs Nexus without a Nexus alias", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-09-16T17:00:00.000Z";
  const observed = (
    provider: "estrelabet" | "superbet",
    teamB: string,
    tournament: string,
  ) => ({
    ...structuredClone(base),
    provider,
    eventId: `${provider}:ex-rustec-nexus`,
    esport: "cs2" as const,
    teamA: "ex-RUSTEC",
    teamB,
    rawTeamA: "ex-RUSTEC",
    rawTeamB: teamB,
    normalizedTeamA: teamName("ex-RUSTEC", "cs2"),
    normalizedTeamB: teamName(teamB, "cs2"),
    tournament,
    startsAt,
    status: "scheduled" as const,
  });
  const left = observed(
    "estrelabet",
    "Nexus Gaming",
    "CCT Europe 2026 Series 9",
  );
  const right = observed("superbet", "Nexus", "CCT - EU");
  const result = compareAllProviders([left, right]);

  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamA, "ex rustec");
  assert.equal(result.matched[0].canonicalEvent.teamB, "nexus");
  assert.equal(result.matched[0].providers.estrelabet.rawTeamB, "Nexus Gaming");
  assert.equal(result.matched[0].providers.superbet.rawTeamB, "Nexus");
  assert.equal(left.normalizedTeamB, "nexus gaming");
  assert.equal(result.matched[0].confidence, 0.9);
  assert.equal(
    compareAllProviders([left, right, { ...right, eventId: "other-nexus" }])
      .matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([left, { ...right, teamA: "RUSTEC" }]).matched.length,
    0,
  );
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
test("LoL LOUD vs LOS matches LOUD vs MIBR LOS with raw names intact", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-09-19T09:00:00.000Z";
  const event = (
    provider: "bet365" | "blaze",
    eventId: string,
    teamB: string,
  ) => ({
    ...structuredClone(base),
    provider,
    eventId,
    esport: "lol" as const,
    teamA: "LOUD",
    teamB,
    rawTeamA: "LOUD",
    rawTeamB: teamB,
    normalizedTeamA: teamName("LOUD", "lol"),
    normalizedTeamB: teamName(teamB, "lol"),
    startsAt,
  });
  const left = event("bet365", "loud-los", "LOS");
  const right = event("blaze", "loud-mibr-los", "MIBR LOS");
  assert.equal(canonicalTeamName("MIBR LOS", "lol"), "los");
  assert.equal(canonicalTeamName("LOS", "lol"), "los");
  assert.equal(canonicalTeamName("MIBR LOS", "cs2"), "mibr los");
  assert.equal(canonicalTeamName("MIBR Other", "lol"), "mibr other");
  const result = compareAllProviders([left, right]);
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.esport, "lol");
  assert.equal(result.matched[0].canonicalEvent.teamA, "loud");
  assert.equal(result.matched[0].canonicalEvent.teamB, "los");
  assert.equal(result.matched[0].canonicalEvent.startsAt, startsAt);
  assert.equal(result.matched[0].providers.bet365.rawTeamB, "LOS");
  assert.equal(result.matched[0].providers.blaze.rawTeamB, "MIBR LOS");
  assert.equal(
    compareAllProviders([
      left,
      { ...right, startsAt: "2026-09-19T10:00:00.000Z" },
    ]).matched.length,
    0,
  );
});

test("LoL 9z Globant alias and generic Team suffix match 9z", async () => {
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
  assert.equal(canonicalTeamName("9z Team", "valorant"), "9z");
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
  assert.equal(canonicalTeamName("Team Liquid", "cs2"), "liquid");
  assert.equal(canonicalTeamName("Example Esports", "cs2"), "example");
  assert.equal(canonicalTeamName("Team Brute", "lol"), "brute");
  assert.notEqual(canonicalTeamName("Team Liquid Academy", "cs2"), "liquid");
  assert.notEqual(canonicalTeamName("Example Youth Esports", "cs2"), "example");
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
  assert.equal(canonicalTeamName("RUSH Gaming", "lol"), "rush");
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

test("CS2 QUAZAR and Team QUAZAR match ex-RUSTEC across NODWIN tournament labels", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-09-16T14:00:00.000Z";
  const observed = (
    provider: "superbet" | "estrelabet",
    teamA: string,
    tournament: string,
  ) => ({
    ...structuredClone(base),
    provider,
    eventId: `${provider}:quazar-ex-rustec`,
    esport: "cs2" as const,
    teamA,
    teamB: "ex-RUSTEC",
    rawTeamA: teamA,
    rawTeamB: "ex-RUSTEC",
    normalizedTeamA: teamName(teamA, "cs2"),
    normalizedTeamB: teamName("ex-RUSTEC", "cs2"),
    tournament,
    startsAt,
    status: "scheduled" as const,
  });
  const left = observed("superbet", "QUAZAR", "NODWIN Clutch Series");
  const right = observed(
    "estrelabet",
    "Team QUAZAR",
    "NODWIN Clutch Series 12",
  );
  const result = compareAllProviders([left, right]);

  assert.equal(canonicalTeamName("QUAZAR", "cs2"), "quazar");
  assert.equal(canonicalTeamName("Team QUAZAR", "cs2"), "quazar");
  assert.equal(canonicalTeamName("Team QUAZAR", "lol"), "quazar");
  assert.notEqual(canonicalTeamName("Team QUAZAR Academy", "cs2"), "quazar");
  assert.equal(right.normalizedTeamA, "team quazar");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamA, "quazar");
  assert.equal(result.matched[0].canonicalEvent.teamB, "ex rustec");
  assert.equal(result.matched[0].providers.superbet.rawTeamA, "QUAZAR");
  assert.equal(result.matched[0].providers.estrelabet.rawTeamA, "Team QUAZAR");
  assert.equal(result.matched[0].confidence, 0.9);
  assert.equal(result.matched[0].evidence.sameCompetitionAlias, false);
  assert.equal(
    compareAllProviders([
      left,
      { ...right, startsAt: "2026-09-16T14:01:00.000Z" },
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
    compareAllProviders([left, right, { ...right, eventId: "second-quazar" }])
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

test("Valorant final (F) markers match Shopify Rebellion Gold vs FlyQuest RED without changing raw names", async () => {
  const raw = JSON.parse(
    await readFile(
      new URL("../../bet365/fixtures/cs2.json", import.meta.url),
      "utf8",
    ),
  );
  const parsed = parseCapture(raw);
  const base = normalizedBet365(parsed.matches, parsed.provenance)[0];
  const startsAt = "2026-09-17T21:00:00.000Z";
  const observed = (
    provider: "superbet" | "estrelabet",
    teamA: string,
    teamB: string,
    tournament: string,
  ) => ({
    ...structuredClone(base),
    provider,
    eventId: `${provider}:shopify-flyquest`,
    esport: "valorant" as const,
    teamA,
    teamB,
    rawTeamA: teamA,
    rawTeamB: teamB,
    normalizedTeamA: teamName(teamA, "valorant"),
    normalizedTeamB: teamName(teamB, "valorant"),
    tournament,
    startsAt,
    status: "scheduled" as const,
  });
  const left = observed(
    "superbet",
    "Shopify Rebellion Gold (F)",
    "FlyQuest RED (F)",
    "Game Changers - NA",
  );
  const right = observed(
    "estrelabet",
    "Shopify Rebellion Gold",
    "FlyQuest RED",
    "VCT 2026: Game Changers North America Stage 2",
  );
  const result = compareAllProviders([left, right]);

  assert.equal(
    canonicalTeamName("Shopify Rebellion Gold (F)", "valorant"),
    "shopify rebellion gold",
  );
  assert.equal(
    canonicalTeamName("Shopify Rebellion Gold(F)", "valorant"),
    "shopify rebellion gold",
  );
  assert.equal(
    canonicalTeamName("FlyQuest RED (F)", "valorant"),
    "flyquest red",
  );
  assert.equal(
    canonicalTeamName("FlyQuest RED(F)", "valorant"),
    "flyquest red",
  );
  assert.equal(left.normalizedTeamA, "shopify rebellion gold f");
  assert.equal(left.normalizedTeamB, "flyquest red f");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(
    result.matched[0].canonicalEvent.teamA,
    "shopify rebellion gold",
  );
  assert.equal(result.matched[0].canonicalEvent.teamB, "flyquest red");
  assert.equal(
    result.matched[0].providers.superbet.rawTeamA,
    "Shopify Rebellion Gold (F)",
  );
  assert.equal(
    result.matched[0].providers.superbet.rawTeamB,
    "FlyQuest RED (F)",
  );
  assert.equal(result.matched[0].confidence, 0.9);
  assert.notEqual(
    canonicalTeamName("FlyQuest RED F", "valorant"),
    "flyquest red",
  );
  assert.notEqual(
    canonicalTeamName("FlyQuest F RED", "valorant"),
    "flyquest red",
  );
  assert.notEqual(
    canonicalTeamName("FlyQuest RED (F) Academy", "valorant"),
    "flyquest red",
  );
  assert.notEqual(canonicalTeamName("FlyQuest RED (F)", "cs2"), "flyquest red");
  assert.equal(canonicalTeamName("FENNEL (F)", "valorant"), "fennel gc");
  assert.equal(
    compareAllProviders([
      left,
      { ...right, startsAt: "2026-09-17T21:01:00.000Z" },
    ]).matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([left, right, { ...right, eventId: "other-shopify" }])
      .matched.length,
    0,
  );
});

test("Nemiga Gaming vs 33 Team matches Nemiga vs Team 33 at the same CS2 start", async () => {
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
    teamB: "33 Team",
    rawTeamA: "Nemiga Gaming",
    rawTeamB: "33 Team",
    normalizedTeamA: teamName("Nemiga Gaming", "cs2"),
    normalizedTeamB: teamName("33 Team", "cs2"),
    startsAt,
  };
  const right = {
    ...structuredClone(base),
    provider: "estrelabet" as const,
    eventId: "nemiga-33",
    teamA: "Nemiga",
    teamB: "Team 33",
    rawTeamA: "Nemiga",
    rawTeamB: "Team 33",
    normalizedTeamA: teamName("Nemiga", "cs2"),
    normalizedTeamB: teamName("Team 33", "cs2"),
    startsAt,
  };

  const result = compareAllProviders([left, right]);

  assert.equal(canonicalTeamName("Nemiga Gaming", "cs2"), "nemiga");
  assert.equal(canonicalTeamName("Nemiga", "cs2"), "nemiga");
  assert.equal(canonicalTeamName("33 Team", "cs2"), "33");
  assert.equal(canonicalTeamName("Team 33", "cs2"), "33");
  assert.equal(
    canonicalTeamName("33", "valorant"),
    canonicalTeamName("Team 33", "valorant"),
  );
  assert.equal(left.normalizedTeamA, "nemiga gaming");
  assert.equal(right.normalizedTeamB, "team 33");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.esport, "cs2");
  assert.equal(result.matched[0].canonicalEvent.teamA, "Nemiga");
  assert.equal(result.matched[0].canonicalEvent.teamB, "33");
  assert.equal(result.matched[0].canonicalEvent.startsAt, startsAt);
  assert.equal(result.matched[0].providers.superbet.rawTeamA, "Nemiga Gaming");
  assert.equal(result.matched[0].providers.superbet.rawTeamB, "33 Team");
  assert.equal(result.matched[0].providers.estrelabet.rawTeamA, "Nemiga");
  assert.equal(result.matched[0].providers.estrelabet.rawTeamB, "Team 33");
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

  assert.equal(canonicalTeamName("Team 33", "cs2"), "33");
  assert.equal(canonicalTeamName("33", "cs2"), "33");
  assert.equal(canonicalTeamName("L&G", "cs2"), "leo");
  assert.equal(canonicalTeamName("Leo Team", "cs2"), "leo");
  assert.notEqual(
    canonicalTeamName("L&G", "valorant"),
    canonicalTeamName("Leo Team", "valorant"),
  );
  assert.equal(left.normalizedTeamB, "l g");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamA, "33");
  assert.equal(result.matched[0].canonicalEvent.teamB, "leo");
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
  assert.equal(
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
  assert.equal(
    canonicalTeamName("Astral eSports", "valorant"),
    canonicalTeamName("ASTRAL", "valorant"),
  );
  assert.equal(left.normalizedTeamA, "astral esports");
  assert.equal(left.normalizedTeamB, "rune eaters esports");
  assert.equal(result.matched.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matched[0].canonicalEvent.teamA, "ASTRAL Esports");
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
  assert.equal(
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
  assert.equal(
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
