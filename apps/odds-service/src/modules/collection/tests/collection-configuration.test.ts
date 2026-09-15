import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionConfiguration } from "../../../config/collection.configuration.js";
import { AdaptiveScheduler } from "../adaptive-scheduler.js";
test("defaults and environment validate provider caps, timeouts and non-aggressive intervals", () => {
  const keys = [
    "COLLECTION_ENABLED",
    "COLLECTION_TICK_MS",
    "COLLECTION_LIST_INTERVAL_MS",
    "COLLECTION_JITTER_MS",
    "BET365_MAX_CONCURRENCY",
    "PROVIDER_LIST_TIMEOUT_MS",
    "DETAIL_INTERVAL_GT_24H_MS",
    "DETAIL_INTERVAL_6H_24H_MS",
    "DETAIL_INTERVAL_1H_6H_MS",
    "DETAIL_INTERVAL_LT_1H_MS",
  ];
  const before = keys.map((k) => process.env[k]);
  try {
    for (const k of keys) delete process.env[k];
    const c = collectionConfiguration();
    assert.equal(c.tickMs, 5000);
    assert.equal(c.listIntervalMs, 300000);
    assert.equal(c.detail.gt24h, 3600000);
    assert.equal(c.detail.h6to24, 1800000);
    assert.equal(c.detail.h1to6, 300000);
    assert.equal(c.detail.lt1h, 60000);
    assert.equal(c.jitterMs, 10000);
    process.env.COLLECTION_ENABLED = "false";
    process.env.COLLECTION_TICK_MS = "7000";
    process.env.COLLECTION_LIST_INTERVAL_MS = "420000";
    process.env.COLLECTION_JITTER_MS = "9000";
    process.env.BET365_MAX_CONCURRENCY = "2";
    process.env.DETAIL_INTERVAL_GT_24H_MS = "900000";
    assert.equal(collectionConfiguration().enabled, false);
    assert.equal(collectionConfiguration().tickMs, 7000);
    assert.equal(collectionConfiguration().listIntervalMs, 420000);
    assert.equal(collectionConfiguration().jitterMs, 9000);
    assert.equal(collectionConfiguration().concurrency.bet365, 2);
    assert.equal(collectionConfiguration().detail.gt24h, 900000);
    process.env.COLLECTION_LIST_INTERVAL_MS = "5000";
    assert.throws(() => collectionConfiguration(), /Invalid/);
    delete process.env.COLLECTION_LIST_INTERVAL_MS;
    process.env.PROVIDER_LIST_TIMEOUT_MS = "NaN";
    assert.throws(() => collectionConfiguration(), /Invalid/);
  } finally {
    keys.forEach((k, i) => {
      if (before[i] === undefined) delete process.env[k];
      else process.env[k] = before[i];
    });
  }
});
test("startup delay and positive jitter use one global tick and cap single-session transport", async () => {
  let now = 0,
    calls = 0;
  const config = {
    ...collectionConfiguration(),
    startupDelayMs: 3000,
    jitterMs: 1000,
    concurrency: { bet365: 8, betano: 1, superbet: 1, blaze: 1, estrelabet: 1 },
  };
  const s = new AdaptiveScheduler(
    config,
    ["bet365"],
    async () => {
      calls++;
      return [];
    },
    () => {},
    () => now,
    () => 0.5,
  );
  s.start();
  now = 3499;
  s.tick();
  assert.equal(calls, 0);
  now = 3500;
  s.tick();
  await s.drain();
  assert.equal(calls, 1);
  assert.equal(s.health().providers.bet365.effectiveConcurrency, 1);
  await s.stop();
});
