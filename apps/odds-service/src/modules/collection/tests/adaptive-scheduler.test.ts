import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { AdaptiveScheduler, type ExecuteJob } from "../adaptive-scheduler.js";
import {
  getDetailInterval,
  backoff,
  EventStartedError,
} from "../scheduling-policy.js";
import { collectionConfiguration } from "../../../config/collection.configuration.js";
import type {
  NormalizedEvent,
  Provider,
} from "../../../shared/domain/normalized-event.js";
const base = Date.parse("2030-01-01T00:00:00Z");
const hour = 3600000;
const event = (
  id = "1",
  hours = 2,
  provider: Provider = "bet365",
): NormalizedEvent => ({
  provider,
  eventId: id,
  esport: "cs2",
  startsAt: new Date(base + hours * hour).toISOString(),
  status: "scheduled",
  inPlay: false,
  markets: [],
  fetchedAt: new Date(base).toISOString(),
  teamA: "A",
  teamB: "B",
  rawTeamA: "A",
  rawTeamB: "B",
  normalizedTeamA: "a",
  normalizedTeamB: "b",
  tournament: "T",
  provenance: {},
  suspended: false,
});
function harness(execute: ExecuteJob, names: Provider[] = ["bet365"]) {
  let now = base;
  const config = {
    ...collectionConfiguration(),
    startupDelayMs: 0,
    jitterMs: 0,
    listIntervalMs: 60000,
    detail: {
      gt24h: 600000,
      h6to24: 300000,
      h1to6: 120000,
      lt1h: 60000,
    },
  };
  const scheduler = new AdaptiveScheduler(
    config,
    names,
    execute,
    () => {},
    () => now,
    () => 0,
  );
  scheduler.start();
  return {
    scheduler,
    config,
    advance: (ms: number) => {
      now += ms;
    },
    set: (time: number) => {
      now = time;
    },
  };
}
async function cycle(s: AdaptiveScheduler) {
  s.tick();
  await s.drain();
}
for (const [hours, expected] of [
  [25, 3600000],
  [24, 1800000],
  [6, 1800000],
  [5, 300000],
  [1, 300000],
  [0.5, 60000],
  [0, null],
  [-1, null],
] as const)
  test(`interval at ${hours} hours`, () =>
    assert.equal(
      getDetailInterval(new Date(base + hours * hour).toISOString(), base),
      expected,
    ));
test("invalid date excluded and custom intervals respected", () => {
  assert.equal(getDetailInterval("invalid", base), null);
  assert.equal(
    getDetailInterval(new Date(base + 25 * hour).toISOString(), base, {
      gt24h: 42,
      h6to24: 3,
      h1to6: 2,
      lt1h: 1,
    }),
    42,
  );
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => backoff(n, [30000, 60000, 120000, 300000])),
    [30000, 60000, 120000, 300000, 300000],
  );
});
test("startup uses delay, not list interval; discovery and detail have separate clocks", async () => {
  let lists = 0,
    details = 0;
  const h = harness(async (job) => {
    job.kind === "list" ? lists++ : details++;
    return [event()];
  });
  h.scheduler.providers.get("bet365")!.list.nextRunAt = base + 3000;
  await cycle(h.scheduler);
  assert.equal(lists, 0);
  h.advance(3000);
  await cycle(h.scheduler);
  assert.equal(lists, 1);
  await cycle(h.scheduler);
  assert.equal(details, 1);
  await cycle(h.scheduler);
  assert.equal(details, 1);
  h.advance(60000);
  await cycle(h.scheduler);
  assert.equal(lists, 2);
  await cycle(h.scheduler);
  assert.equal(details, 1);
  h.advance(60000);
  await cycle(h.scheduler);
  await cycle(h.scheduler);
  assert.equal(details, 2);
  await h.scheduler.stop();
});
test("detail is sorted by start; jitter delays but does not perpetually postpone first detail", async () => {
  const ids: string[] = [];
  const h = harness(async (job) => {
    if (job.kind === "detail") ids.push(job.event.eventId);
    return [event("far", 30), event("middle", 8), event("soon", 0.5)];
  });
  await cycle(h.scheduler);
  for (const s of h.scheduler.details.values()) s.jitter = 500;
  await cycle(h.scheduler);
  assert.deepEqual(ids, []);
  h.advance(500);
  await cycle(h.scheduler);
  await cycle(h.scheduler);
  await cycle(h.scheduler);
  assert.deepEqual(ids, ["soon", "middle", "far"]);
  await h.scheduler.stop();
});
test("proximity and rescheduled start recalculate interval without fetching prematurely", async () => {
  let target = event("1", 25);
  let detail = 0;
  const h = harness(async (job) => {
    if (job.kind === "detail") detail++;
    return [target];
  });
  await cycle(h.scheduler);
  await cycle(h.scheduler);
  assert.equal(h.scheduler.details.get("bet365:1")!.nextRunAt, base + 600000);
  target = event("1", 0.5);
  h.advance(60000);
  await cycle(h.scheduler);
  await cycle(h.scheduler);
  assert.equal(detail, 2);
  h.set(base + hour);
  await cycle(h.scheduler);
  await cycle(h.scheduler);
  assert.equal(h.scheduler.details.get("bet365:1")!.nextRunAt, null);
  assert.equal(detail, 2);
  assert.equal(h.scheduler.catalog.get("bet365:1")!.status, "scheduled");
  await h.scheduler.stop();
});
test("never overlaps same event/provider; different providers run concurrently", async () => {
  const pending: Array<() => void> = [];
  let current = 0,
    max = 0;
  const h = harness(
    async (job) => {
      if (job.kind === "list")
        return [event("1", 2, job.provider), event("2", 3, job.provider)];
      current++;
      max = Math.max(max, current);
      await new Promise<void>((r) => pending.push(r));
      current--;
      return [event("1", 2, job.provider)];
    },
    ["bet365", "betano"],
  );
  await cycle(h.scheduler);
  h.scheduler.tick();
  h.scheduler.tick();
  h.scheduler.tick();
  assert.equal(pending.length, 2);
  assert.equal(h.scheduler.health().scheduler.activeJobs, 2);
  assert.equal(max, 2);
  for (const p of h.scheduler.providers.values()) assert.equal(p.activeJobs, 1);
  pending.forEach((r) => r());
  await h.scheduler.drain();
  await h.scheduler.stop();
});
test("discovery failure keeps catalog; valid additions/removals are never finishes", async () => {
  let fail = false,
    events = [event("1")];
  const h = harness(async () => {
    if (fail) throw Error("offline");
    return events;
  });
  await cycle(h.scheduler);
  assert.deepEqual(
    h.scheduler.catalogChanges.get("bet365")!.map((c) => c.type),
    ["EventAdded"],
  );
  fail = true;
  h.advance(60000);
  await cycle(h.scheduler);
  assert.equal(h.scheduler.catalog.size, 1);
  assert.equal(h.scheduler.providers.get("bet365")!.list.failureCount, 1);
  assert.equal(
    h.scheduler.providers.get("bet365")!.list.nextRunAt,
    base + 90000,
  );
  await cycle(h.scheduler);
  assert.equal(h.scheduler.providers.get("bet365")!.list.failureCount, 1);
  fail = false;
  events = [event("2")];
  h.advance(30000);
  await cycle(h.scheduler);
  assert.deepEqual(
    h.scheduler.catalogChanges.get("bet365")!.map((c) => c.type),
    ["EventRemoved", "EventAdded"],
  );
  assert.equal(h.scheduler.providers.get("bet365")!.list.failureCount, 0);
  assert.equal(h.scheduler.providers.get("bet365")!.consecutiveFailures, 0);
  await h.scheduler.stop();
});
test("detail failure backoff and recovery retain prior success", async () => {
  let fail = false;
  const h = harness(async (job) => {
    if (job.kind === "detail" && fail) throw Error("offline");
    return [event()];
  });
  await cycle(h.scheduler);
  await cycle(h.scheduler);
  const s = h.scheduler.details.get("bet365:1")!;
  fail = true;
  h.advance(120000);
  await cycle(h.scheduler);
  await cycle(h.scheduler);
  assert.equal(s.lastSuccessAt, base);
  assert.equal(s.failureCount, 1);
  assert.equal(s.nextRunAt, base + 150000);
  fail = false;
  h.advance(60000);
  await cycle(h.scheduler);
  await cycle(h.scheduler);
  assert.equal(s.failureCount, 0);
  assert.equal(s.lastSuccessAt, base + 180000);
  await h.scheduler.stop();
});
test("provider circuit opens at threshold, blocks cooldown, and probes after", async () => {
  let calls = 0,
    fail = true;
  const h = harness(async () => {
    calls++;
    if (fail) throw Error("offline");
    return [];
  });
  h.config.failureThreshold = 2;
  await cycle(h.scheduler);
  h.advance(30000);
  await cycle(h.scheduler);
  assert.equal(calls, 2);
  const p = h.scheduler.providers.get("bet365")!;
  assert.equal(p.cooldownUntil, base + 330000);
  h.advance(299999);
  await cycle(h.scheduler);
  assert.equal(calls, 2);
  h.advance(1);
  fail = false;
  await cycle(h.scheduler);
  assert.equal(calls, 3);
  assert.equal(p.consecutiveFailures, 0);
  assert.equal(p.cooldownUntil, null);
  await h.scheduler.stop();
});
test("timeout cancels cooperatively, releases locks and applies backoff", async () => {
  const h = harness(async (_job, signal) => {
    await new Promise<void>((_r, j) =>
      signal.addEventListener("abort", () => j(signal.reason), { once: true }),
    );
    return [];
  });
  h.config.listTimeoutMs = 10;
  h.scheduler.tick();
  await h.scheduler.drain();
  const p = h.scheduler.providers.get("bet365")!;
  assert.equal(p.activeJobs, 0);
  assert.equal(p.list.currentlyRunning, false);
  assert.equal(p.list.lastError, "timeout");
  assert.equal(p.list.failureCount, 1);
  await h.scheduler.stop();
});
test("uncooperative operation retains safety lock until drained, then ignores late response", async () => {
  let release!: () => void;
  const h = harness(async () => {
    await new Promise<void>((r) => {
      release = r;
    });
    return [event()];
  });
  h.config.listTimeoutMs = 5;
  h.scheduler.tick();
  await sleep(15);
  h.scheduler.tick();
  assert.equal(h.scheduler.health().scheduler.activeJobs, 1);
  release();
  await h.scheduler.drain();
  assert.equal(h.scheduler.catalog.size, 0);
  assert.equal(h.scheduler.health().scheduler.activeJobs, 0);
  await h.scheduler.stop();
});
test("shutdown stops new work and waits for a committing publication, even beyond grace", async () => {
  let release!: () => void,
    calls = 0;
  const h = harness(async (_job, _signal, commit) => {
    calls++;
    commit();
    await new Promise<void>((r) => {
      release = r;
    });
    return [];
  });
  h.config.shutdownGraceMs = 5;
  h.scheduler.tick();
  const stop = h.scheduler.stop();
  h.scheduler.tick();
  await sleep(15);
  assert.equal(calls, 1);
  assert.equal(h.scheduler.health().scheduler.activeJobs, 1);
  release();
  await stop;
  assert.equal(h.scheduler.health().scheduler.running, false);
  assert.equal(h.scheduler.health().scheduler.activeJobs, 0);
});
test("shutdown grace aborts collection, drains it, and never counts shutdown as provider failure", async () => {
  const h = harness(async (_job, signal) => {
    await new Promise<void>((_r, j) =>
      signal.addEventListener("abort", () => j(signal.reason), { once: true }),
    );
    return [];
  });
  h.config.shutdownGraceMs = 5;
  h.scheduler.tick();
  await h.scheduler.stop();
  assert.equal(h.scheduler.health().scheduler.activeJobs, 0);
  assert.equal(h.scheduler.providers.get("bet365")!.consecutiveFailures, 0);
});

test("invalid detail is isolated to its event; other due details do not wait for discovery", async () => {
  const attempted: string[] = [];
  const h = harness(async (job) => {
    if (job.kind === "list") return [event("bad", 2), event("good", 3)];
    attempted.push(job.event.eventId);
    if (job.event.eventId === "bad") throw Error("Incomplete coupon");
    return [event("good", 3)];
  });
  await cycle(h.scheduler);
  await cycle(h.scheduler);
  assert.equal(h.scheduler.providers.get("bet365")!.contextReady, true);
  await cycle(h.scheduler);
  assert.deepEqual(attempted, ["bad", "good"]);
  assert.equal(h.scheduler.details.get("bet365:bad")!.failureCount, 1);
  assert.equal(h.scheduler.details.get("bet365:good")!.lastSuccessAt, base);
  await h.scheduler.stop();
});

test("detail response indicating start remains stopped until discovery explicitly reschedules", async () => {
  const h = harness(async (job) => {
    if (job.kind === "detail") throw new EventStartedError();
    return [event("1", 2)];
  });
  await cycle(h.scheduler);
  await cycle(h.scheduler);
  h.advance(120000);
  await cycle(h.scheduler);
  await cycle(h.scheduler);
  assert.equal(h.scheduler.details.get("bet365:1")!.preGameStopped, true);
  assert.equal(h.scheduler.details.get("bet365:1")!.nextRunAt, null);
  assert.equal(h.scheduler.providers.get("bet365")!.consecutiveFailures, 0);
  await h.scheduler.stop();
});
