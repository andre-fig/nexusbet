import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CollectionService } from "../collection.service.js";
import { ProviderRegistry } from "../provider-registry.js";
import {
  configuration,
  type AppConfiguration,
} from "../../../config/configuration.js";
import type { ProviderRuntime } from "../../../shared/interfaces/odds-provider.interface.js";
import type {
  NormalizedEvent,
  Provider,
} from "../../../shared/domain/normalized-event.js";
import { StaleDataError } from "../../../shared/errors/domain-errors.js";
const config: AppConfiguration = configuration();
function provider(name: Provider): ProviderRuntime {
  return {
    name,
    pollCadence: "round",
    collectEvents: async () => [],
    collectEventDetails: async () => {
      throw Error("fixture detail unavailable");
    },
    readEvents: () => [],
    readDetail: () => {
      throw Error("unavailable");
    },
    refresh: async () => {},
    health: () => ({}),
    selectDetail: () => undefined,
    closeCollection: async () => {},
  };
}
test("matching eligibility excludes stale and runtime-disabled providers per esport", () => {
  const healthy = provider("superbet"),
    stale = provider("blaze"),
    disabled = provider("bet365");
  stale.readEvents = () => {
    throw new StaleDataError("stale listing");
  };
  const settings = structuredClone(config.settings);
  settings.providerEnabled.bet365 = false;
  const service = new CollectionService(
    new ProviderRegistry([healthy, stale, disabled]),
    { settings } as AppConfiguration,
  );
  assert.deepEqual(service.matchingEligibleProviders(["cs2"]), {
    cs2: ["superbet"],
  });
});
for (const failing of ["bet365", "betano"] as const)
  test(`${failing} manual failure does not restore disabled browser stores`, async () => {
    const a = provider("bet365"),
      b = provider("betano");
    const bad = failing === "bet365" ? a : b;
    bad.collectEvents = async () => {
      throw Error("offline");
    };
    bad.refresh = async () => {
      throw Error("offline");
    };
    const service = new CollectionService(new ProviderRegistry([a, b]), config);
    const results = await service.collectCycle(["bet365", "betano"], {
      esports: ["cs2"],
    });
    assert.equal(results.find((r) => r.provider === failing)?.status, "failed");
    assert.equal(results.find((r) => r.provider !== failing)?.status, "ok");
    const refresh = await service.refresh();
    assert.equal(refresh.length, 0);
  });
test("refresh restores only runtime-active providers and isolates their failures", async () => {
  const a = provider("bet365"),
    b = provider("betano"),
    c = provider("superbet"),
    d = provider("blaze"),
    e = provider("estrelabet");
  const called: string[] = [];
  for (const p of [a, b, c, d, e])
    p.refresh = async () => {
      called.push(p.name);
      if (p.name === "blaze") throw Error("offline");
    };
  const settings = structuredClone(config.settings);
  settings.browser.runtime = "disabled";
  settings.blazeEnabled = true;
  settings.estrelabetEnabled = false;
  const service = new CollectionService(new ProviderRegistry([a, b, c, d, e]), {
    settings,
  } as AppConfiguration);
  const result = await service.refresh();
  assert.deepEqual(called, ["superbet", "blaze"]);
  assert.deepEqual(
    result.map((item) => item.status),
    ["fulfilled", "rejected"],
  );
});
test("unknown provider is isolated and partial listing survives detail failure", async () => {
  const a = provider("bet365"),
    event = {
      eventId: "1",
      provider: "bet365",
      esport: "cs2",
      tournament: "Test League",
      teamA: "Alpha",
      teamB: "Beta",
      rawTeamA: "Alpha",
      rawTeamB: "Beta",
      normalizedTeamA: "alpha",
      normalizedTeamB: "beta",
      markets: [],
      fetchedAt: new Date().toISOString(),
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      status: "scheduled",
      inPlay: false,
      suspended: false,
      provenance: {},
    } satisfies NormalizedEvent;
  a.collectEvents = async () => [event];
  a.readEvents = () => [event];
  a.selectDetail = () => ({ provider: "bet365", eventId: "1", esport: "cs2" });
  const service = new CollectionService(new ProviderRegistry([a]), config);
  const r = await service.collectCycle(["missing", "bet365"], {
    esports: ["cs2"],
    details: true,
  });
  assert.equal(r[0].status, "failed");
  assert.equal(r[1].status, "partial");
  assert.equal(r[1].events, 1);
  assert.equal(r[1].details, 0);
});
test("concurrent cycles cannot duplicate collection and cleanup always runs", async () => {
  const a = provider("betano");
  let release!: () => void,
    closed = 0;
  a.collectEvents = () =>
    new Promise((resolve) => {
      release = () => resolve([]);
    });
  a.closeCollection = async () => {
    closed++;
  };
  const service = new CollectionService(new ProviderRegistry([a]), config);
  const first = service.collectCycle(["betano"], { esports: ["cs2"] });
  assert.equal(
    (await service.collectCycle(["betano"], { esports: ["cs2"] }))[0].status,
    "busy",
  );
  release();
  assert.equal((await first)[0].status, "ok");
  assert.equal(closed, 1);
});
test("duplicate polling loop is rejected; abort closes transport", async () => {
  const a = provider("betano");
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  a.collectEvents = async () => {
    started();
    return [];
  };
  const service = new CollectionService(new ProviderRegistry([a]), config);
  const abort = new AbortController();
  const first = service.runLoop(["betano"], { esports: ["cs2"] }, abort.signal);
  await ready;
  assert.deepEqual(
    await service.runLoop(["betano"], { esports: ["cs2"] }, abort.signal),
    [false],
  );
  abort.abort();
  assert.deepEqual(await first, [true]);
});
