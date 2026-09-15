/** Optional localhost E2E: only a COPY of real data in a database ending _validation. */
import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import type { PersistencePublication } from "../../../shared/interfaces/persistence-port.interface.js";
import type { NormalizedEvent } from "../../../shared/domain/normalized-event.js";
import type { MarketBatch } from "../../../shared/domain/market-model.js";
import type { DetailedMatch } from "../../../shared/domain/market-model.js";
const databaseUrl = process.env.MONITOR_E2E_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_validation"))
  throw Error(
    "Set MONITOR_E2E_DATABASE_URL to an isolated COPY ending _validation",
  );
const frontend =
  process.env.MONITOR_E2E_FRONTEND_URL || "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(frontend).hostname))
  throw Error("E2E frontend must be localhost");
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  PERSISTENCE_MODE: "postgres",
  COLLECTION_ENABLED: "false",
  INBOX_SCAN_ENABLED: "0",
  INBOX_INGEST_ENABLED: "0",
  POLLING_ENABLED: "0",
  DATA_DIR: "evidence/monitor/e2e-state",
  BET365_ENABLED: "false",
  BETANO_ENABLED: "false",
  ODDS_MONITOR_ORIGIN: new URL(frontend).origin,
});
const { createApp } = await import("../../../bootstrap.js");
const { PersistenceService } =
  await import("../../persistence/persistence.service.js");
const { DatabaseService } = await import("../../database/database.service.js");
const app = await createApp();
await app.listen(3199, "127.0.0.1");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const requests: string[] = [];
page.on("request", (r) => {
  if (r.url().includes("/monitor/")) requests.push(new URL(r.url()).pathname);
});
await mkdir("evidence/monitor", { recursive: true });
try {
  const db = app.get(DatabaseService).db;
  const feed = await db.feedScope.findFirstOrThrow({
    where: { provider: { slug: "estrelabet" }, kind: "detail", esport: "cs2" },
    orderBy: { fetchedAt: "desc" },
  });
  const original = (feed.events as unknown as NormalizedEvent[])[0];
  const row = await db.providerEvent.findFirstOrThrow({
    where: {
      provider: { slug: original.provider },
      providerEventId: original.eventId,
    },
    include: { match: true },
  });
  const eventId = row.match?.canonicalEventId ?? row.id;
  const detail = await (
    await fetch(`http://127.0.0.1:3199/monitor/events/${eventId}`)
  ).json();
  assert.ok(detail.markets.length);
  const market = detail.markets.find(
    (m: { category: string }) => m.category === "match_winner",
  );
  assert.ok(market);
  const runner = market.selections[0];
  await page.goto(frontend);
  await page.getByText("Live updates connected").waitFor();
  assert.equal(await page.getByText("Pinnacle", { exact: true }).count(), 0);
  await page.getByLabel("Search events").fill(original.teamA);
  await page
    .getByRole("button", {
      name: `${original.teamA} vs ${original.teamB}`,
      exact: true,
    })
    .click();
  await page.getByText("Priority markets", { exact: true }).waitFor();
  await page.getByLabel("History selection").selectOption(runner.id);
  await page.getByRole("img", { name: "Observed odds history" }).waitFor();
  await page.getByRole("button", { name: "Raw JSON", exact: true }).click();
  await page.locator("pre").waitFor();
  const raw = await page.locator("pre").innerText();
  assert.ok(
    !/"(?:password|cookies|authorization|access_token)"\s*:/i.test(raw),
  );
  await page.screenshot({
    path: "evidence/monitor/detail-before.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    (window as unknown as { monitorSentinel: string }).monitorSentinel =
      "preserved";
  });
  const at = new Date().toISOString();
  const events = structuredClone(feed.events as unknown as NormalizedEvent[]);
  const observations = structuredClone(
    feed.observations as unknown as MarketBatch[],
  );
  const value = Number((runner.odds + 0.013).toFixed(5));
  function update(e: DetailedMatch) {
    e.fetchedAt = at;
    for (const m of e.markets) {
      m.fetchedAt = at;
      if (m.marketId === market.providerMarketId)
        for (const s of m.selections)
          if (s.selectionId === runner.selectionId) s.odds = value;
    }
  }
  events.forEach(update);
  for (const b of observations) {
    b.fetchedAt = at;
    b.matches.forEach(update);
  }
  const p: PersistencePublication = {
    provider: original.provider,
    esport: original.esport,
    kind: "detail",
    scope: feed.name,
    fetchedAt: at,
    events,
    observations,
    checkpoint: { key: "monitor:e2e", payload: { controlled: true } },
  };
  await app.get(PersistenceService).commit(p);
  await page.waitForFunction(
    (odd) => document.querySelector("main")?.textContent?.includes(odd),
    value.toLocaleString("en-US", { maximumFractionDigits: 5 }),
  );
  assert.equal(
    await page.evaluate(
      () => (window as unknown as { monitorSentinel: string }).monitorSentinel,
    ),
    "preserved",
  );
  await page.getByRole("button", { name: "Sync Event", exact: true }).click();
  await page.getByText("Loading data…").first().waitFor({ state: "hidden" });
  await page.screenshot({
    path: "evidence/monitor/detail-after.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back to Dashboard" }).click();
  await page.getByRole("button", { name: /Needs attention/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Inspect event" }).first().waitFor();
  await page.screenshot({
    path: "evidence/monitor/issues.png",
    fullPage: true,
  });
  const overview = await (
    await fetch("http://127.0.0.1:3199/monitor/overview")
  ).json();
  assert.equal(errors.length, 0);
  assert.ok(requests.includes("/monitor/stream"));
  const report = {
    at: new Date().toISOString(),
    database: new URL(databaseUrl).pathname,
    chrome: browser.version(),
    eventId,
    overview: overview.health,
    providers: overview.providers.map((p: { id: string }) => p.id),
    before: runner.odds,
    after: value,
    restRequests: requests.length,
    pageErrors: errors,
    fullReload: false,
    checks: [
      "dashboard",
      "dynamic providers",
      "detail",
      "priority markets",
      "history",
      "raw sanitized",
      "issues",
      "SSE invalidation after commit",
      "manual refresh",
    ],
  };
  await writeFile("evidence/monitor/e2e.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({
    path: "evidence/monitor/failure.png",
    fullPage: true,
  });
  console.log({ url: page.url(), errors, requests });
  throw error;
} finally {
  await browser.close();
  await app.close();
}
