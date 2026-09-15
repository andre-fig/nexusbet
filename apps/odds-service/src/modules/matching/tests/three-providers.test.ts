import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compareAllProviders } from "../matching.js";
import { parseListing } from "../../superbet/parsers/feed.parser.js";
import { normalizeListingRound } from "../../betano/persistence/betano.store.js";
import { parseCapture } from "../../bet365/parsers/list.parser.js";
import { normalizedBet365 } from "../../bet365/mappers/bet365.mapper.js";
const fixture = async (provider: string, name: string) =>
  JSON.parse(
    await readFile(
      new URL(`../../${provider}/fixtures/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
async function sources() {
  const a = parseCapture(await fixture("bet365", "details/lol-list"));
  return {
    a: normalizedBet365(a.matches, a.provenance),
    b: normalizeListingRound(await fixture("betano", "lol-round")).matches,
    c: parseListing(
      await fixture("superbet", "lol-list"),
      "lol",
      await fixture("superbet", "structure"),
    ),
  };
}
test("real fixtures match three providers, two providers, one provider, and divergent names", async () => {
  const { a, b, c } = await sources(),
    result = compareAllProviders([...a, ...b, ...c]);
  const red = result.matched.find(
    (m) => m.canonicalEvent.teamA === "red canids",
  )!;
  assert.deepEqual(Object.keys(red.providers), [
    "bet365",
    "betano",
    "superbet",
  ]);
  assert.equal(red.confidence, 1);
  assert.equal(red.providers.superbet.rawTeamB, "Vivo Keyd Stars");
  assert.equal(red.providers.superbet.normalizedTeamB, "vivo keyd stars");
  assert.ok(result.matched.some((m) => Object.keys(m.providers).length === 2));
  assert.ok(result.unmatched.some((m) => m.provider === "superbet"));
  assert.ok(compareAllProviders([...a, ...c]).matched.length);
  assert.ok(compareAllProviders([...b, ...c]).matched.length);
  const single = compareAllProviders(c);
  assert.equal(single.matched.length, 0);
  assert.equal(single.unmatched.length, 0);
  assert.equal(single.notApplicable.length, c.length);
  assert.ok(
    single.notApplicable.every(
      (event) => event.reason === "only_one_eligible_provider",
    ),
  );
});
test("an incomplete match winner is excluded from matched odds", async () => {
  const { a, b, c } = await sources();
  const original = compareAllProviders([...a, ...b, ...c]).matched.find(
    (match) => match.canonicalEvent.teamA === "red canids",
  )!;
  const event = c.find(
    (candidate) => candidate.eventId === original.providers.superbet.eventId,
  )!;
  const incomplete = structuredClone(event);
  const winner = incomplete.markets.find(
    (market) => market.category === "match_winner",
  )!;
  winner.selections = winner.selections.slice(0, 1);
  const result = compareAllProviders([
    ...a,
    ...b,
    ...c.filter((candidate) => candidate !== event),
    incomplete,
  ]);
  const match = result.matched.find(
    (candidate) => candidate.canonicalEvent.teamA === "red canids",
  )!;
  assert.ok(match);
  assert.ok(
    !match.providers.superbet.odds.some(
      (market) => market.category === "match_winner",
    ),
  );
});
test("eligibility quorum distinguishes not-applicable from a real unmatched event", async () => {
  const { c } = await sources();
  const event = c[0];
  const alone = compareAllProviders([event], ["superbet"]);
  assert.equal(alone.notApplicable.length, 1);
  assert.equal(alone.unmatched.length, 0);
  const withAnotherEligibleProvider = compareAllProviders(
    [event],
    ["superbet", "blaze"],
  );
  assert.equal(withAnotherEligibleProvider.notApplicable.length, 0);
  assert.deepEqual(withAnotherEligibleProvider.unmatched, [
    { provider: "superbet", eventId: event.eventId, reason: "no_team_pair" },
  ]);
});
test("ineligible providers never enter matching or its quorum", async () => {
  const { c } = await sources();
  const event = c[0];
  const peers = ["bet365", "betano", "blaze", "estrelabet"].map((provider) => ({
    ...event,
    provider: provider as typeof event.provider,
  }));
  const events = [event, ...peers];
  const two = compareAllProviders(events, ["superbet", "blaze"]);
  assert.equal(two.matched.length, 1);
  assert.deepEqual(Object.keys(two.matched[0].providers).sort(), [
    "blaze",
    "superbet",
  ]);
  assert.equal(two.unmatched.length, 0);
  const one = compareAllProviders(events, ["superbet"]);
  assert.deepEqual(one.notApplicable, [
    {
      provider: "superbet",
      eventId: event.eventId,
      reason: "only_one_eligible_provider",
    },
  ]);
  assert.equal(one.unmatched.length, 0);
  const three = compareAllProviders(events, [
    "superbet",
    "blaze",
    "estrelabet",
  ]);
  assert.equal(three.matched.length, 1);
  assert.equal(Object.keys(three.matched[0].providers).length, 3);
  const absent = compareAllProviders(
    [event, peers[2]],
    ["superbet", "blaze", "estrelabet"],
  );
  assert.equal(absent.matched.length, 1);
  assert.equal(Object.keys(absent.matched[0].providers).length, 2);
  const unmatched = compareAllProviders(
    [event, peers[0]],
    ["superbet", "blaze"],
  );
  assert.equal(unmatched.unmatched.length, 1);
});
test("provider-scoped equal IDs do not collide; ambiguity, different starts and false positives stay unmatched", async () => {
  const { c } = await sources(),
    e = c[0];
  const a = { ...e, provider: "bet365" as const },
    b = { ...e, provider: "betano" as const };
  assert.equal(compareAllProviders([a, b, e]).matched.length, 1);
  assert.equal(
    compareAllProviders([a, b, e, { ...e, eventId: "second" }]).matched.length,
    0,
  );
  assert.equal(
    compareAllProviders([a, { ...b, teamA: b.teamA + " Academy" }, e])
      .matched[0].providers.betano,
    undefined,
  );
  const at = Date.parse(e.startsAt);
  assert.equal(
    compareAllProviders([
      a,
      { ...b, startsAt: new Date(at + 10 * 60000).toISOString() },
      { ...e, startsAt: new Date(at + 20 * 60000).toISOString() },
    ]).matched.length,
    0,
  );
  const differentTournament = compareAllProviders([
    a,
    { ...e, tournament: "Unrelated season" },
  ]).matched[0];
  assert.equal(differentTournament.confidence, 0.9);
  assert.equal(differentTournament.evidence.sameCompetitionAlias, false);
  assert.equal(
    compareAllProviders([a, { ...e, esport: "valorant" }]).matched.length,
    0,
  );
  const reversed = { ...e, teamA: e.teamB, teamB: e.teamA };
  assert.equal(
    compareAllProviders([a, reversed]).matched[0].providers.superbet.reversed,
    true,
  );
});
