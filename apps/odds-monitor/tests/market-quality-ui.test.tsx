import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { EventDetailView } from "../src/components/EventDetailView";
import { DashboardView } from "../src/components/DashboardView";
import { NeedsAttentionDrawer } from "../src/components/NeedsAttentionDrawer";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/monitor.json", import.meta.url), "utf8"),
);
const resource = (data: unknown) => ({
  data,
  loading: false,
  refreshing: false,
  error: null,
});

test("detail shows stale retained odds, incomplete market and missing provider map separately", () => {
  const detail = structuredClone(fixture.detail);
  detail.markets[0].status = "stale";
  detail.markets[0].selections[0].status = "stale";
  detail.markets[1].status = "incomplete";
  const blaze = { ...structuredClone(detail.providers[0]), provider: "blaze" };
  detail.providers.push(blaze);
  const map3 = structuredClone(detail.markets[1]);
  map3.id = "blaze:map3";
  map3.provider = "blaze";
  map3.mapNumber = 3;
  map3.status = "healthy";
  detail.markets.push(map3);
  const html = renderToStaticMarkup(
    <EventDetailView
      detail={resource(detail) as never}
      history={resource(null) as never}
      raw={resource(null) as never}
      showRaw={false}
      onToggleRaw={() => {}}
      selection=""
      onSelection={() => {}}
      onBackToDashboard={() => {}}
      onSyncEvent={() => {}}
    />,
  );
  assert.match(html, /1,53<\/span> · stale/);
  assert.match(html, /Last observed .*excluded from comparisons/);
  assert.match(html, /Incomplete market/);
  assert.match(html, /fewer than two valid selections/);
  assert.match(html, /Map 3 winner/);
  assert.match(html, /Market unavailable/);
  assert.match(html, /other markets can still be compared/);
});

test("dashboard shows one stale label below odds even when the provider is healthy", () => {
  const row = structuredClone(fixture.events.items[0]);
  row.providers[0].status = "healthy";
  row.providers[0].matchWinner.status = "stale";
  const overview = structuredClone(fixture.overview);
  overview.providers.find(
    (p: { id: string }) => p.id === row.providers[0].provider,
  ).status = "healthy";
  const dashboard = renderToStaticMarkup(
    <DashboardView
      overview={resource(overview) as never}
      events={
        resource({
          items: [row],
          pagination: { page: 1, limit: 50, total: 1, pages: 1 },
        }) as never
      }
      filters={{
        search: "",
        esport: "",
        status: "",
        start: "",
        provider: "",
        attentionOnly: "false",
        page: "1",
        limit: "50",
      }}
      onFilter={() => {}}
      onOpenIssuesDrawer={() => {}}
      onOpenEventDetail={() => {}}
    />,
  );
  assert.match(dashboard, /1,53/);
  assert.match(dashboard, /2,30/);
  assert.doesNotMatch(dashboard, /· stale/);
  assert.equal(dashboard.match(/>Stale</g)?.length, 1);
  assert.match(dashboard, /excluded from comparisons/);
  const issue = {
    ...fixture.issues.items[0],
    type: "STALE",
    severity: "warning",
    message: "Map 1 winner exceeded freshness TTL",
  };
  const drawer = renderToStaticMarkup(
    <NeedsAttentionDrawer
      isOpen
      onClose={() => {}}
      onInspectIssue={() => {}}
      issues={resource({ items: [issue] }) as never}
    />,
  );
  assert.match(drawer, /Stale market/);
  assert.match(drawer, /Map 1 winner exceeded freshness TTL/);
});
