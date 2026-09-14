import { test } from "node:test";
import assert from "node:assert/strict";
import { AdaptiveScheduler } from "../../collection/adaptive-scheduler.js";
import { collectionConfiguration } from "../../../config/collection.configuration.js";
import type {
  Provider,
  NormalizedEvent,
} from "../../../shared/domain/normalized-event.js";
const base = Date.parse("2030-01-01T00:00:00Z");
const event = (provider: Provider, id = "same"): NormalizedEvent => ({
  provider,
  eventId: id,
  esport: "lol",
  teamA: "A",
  teamB: "B",
  rawTeamA: "A",
  rawTeamB: "B",
  normalizedTeamA: "a",
  normalizedTeamB: "b",
  tournament: "T",
  startsAt: new Date(base + 3600000).toISOString(),
  fetchedAt: new Date(base).toISOString(),
  status: "scheduled",
  inPlay: false,
  suspended: false,
  markets: [],
  provenance: {},
});
test("three-provider queue keeps locks independent and never exceeds one job per provider", async () => {
  let active = 0,
    max = 0;
  const release: Array<() => void> = [];
  const s = new AdaptiveScheduler(
    { ...collectionConfiguration(), startupDelayMs: 0, jitterMs: 0 },
    ["bet365", "betano", "superbet"],
    async (job) => {
      if (job.kind === "list")
        return [event(job.provider), event(job.provider, "second")];
      active++;
      max = Math.max(max, active);
      await new Promise<void>((r) => release.push(r));
      active--;
      return [event(job.provider)];
    },
    () => {},
    () => base,
    () => 0,
  );
  s.start();
  s.tick();
  await s.drain();
  s.tick();
  s.tick();
  s.tick();
  assert.equal(max, 3);
  assert.equal(release.length, 3);
  for (const p of s.providers.values()) assert.equal(p.activeJobs, 1);
  release.forEach((r) => r());
  await s.drain();
  await s.stop();
  assert.equal(s.health().scheduler.activeJobs, 0);
});
test("Superbet timeout releases lock, backoff/circuit are local, cooldown recovers and old sources stay healthy", async () => {
  let now = base,
    fail = true,
    calls = 0;
  const config = {
    ...collectionConfiguration(),
    startupDelayMs: 0,
    jitterMs: 0,
    listTimeoutMs: 10,
    failureThreshold: 2,
  };
  const s = new AdaptiveScheduler(
    config,
    ["bet365", "betano", "superbet"],
    async (job, signal) => {
      if (job.provider === "superbet") {
        calls++;
        if (fail)
          await new Promise<void>((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          );
      }
      return [event(job.provider)];
    },
    () => {},
    () => now,
    () => 0,
  );
  const cycle = async () => {
    s.tick();
    await s.drain();
  };
  s.start();
  await cycle();
  let p = s.providers.get("superbet")!;
  assert.equal(p.activeJobs, 0);
  assert.equal(p.list.currentlyRunning, false);
  assert.equal(p.list.failureCount, 1);
  assert.equal(p.list.nextRunAt, base + 30000);
  assert.equal(p.list.lastError, "timeout");
  now += 29999;
  await cycle();
  assert.equal(calls, 1);
  now++;
  await cycle();
  assert.equal(p.consecutiveFailures, 2);
  assert.equal(p.cooldownUntil, now + 300000);
  assert.equal(s.health().providers.superbet.status, "degraded");
  for (const name of ["bet365", "betano"] as const)
    assert.equal(s.providers.get(name)!.consecutiveFailures, 0);
  now += 299999;
  await cycle();
  assert.equal(calls, 2);
  now++;
  fail = false;
  await cycle();
  assert.equal(calls, 3);
  assert.equal(p.list.failureCount, 0);
  assert.equal(p.cooldownUntil, null);
  assert.ok(s.catalog.has("superbet:same"));
  await s.stop();
});
