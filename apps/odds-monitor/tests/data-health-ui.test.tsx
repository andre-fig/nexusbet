import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
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
const filters = {
  search: "",
  esport: "",
  status: "",
  start: "",
  provider: "",
  attentionOnly: "false",
  page: "1",
  limit: "50",
};
const dashboard = (overview: unknown) =>
  renderToStaticMarkup(
    <DashboardView
      overview={resource(overview) as never}
      events={resource(fixture.events) as never}
      filters={filters}
      onFilter={() => {}}
      onOpenIssuesDrawer={() => {}}
      onOpenEventDetail={() => {}}
    />,
  );

test("Data Health can be healthy while local issues remain in Needs attention", () => {
  const overview = structuredClone(fixture.overview);
  overview.health.status = "healthy";
  overview.health.issues = 1;
  overview.health.reasons = [];
  const html = dashboard(overview);
  assert.match(html, /Data healthy/);
  assert.match(html, /1 Needs attention/);
  assert.match(html, /Event-level issues remain in Needs attention/);
  const drawer = renderToStaticMarkup(
    <NeedsAttentionDrawer
      isOpen
      onClose={() => {}}
      onInspectIssue={() => {}}
      issues={resource(fixture.issues) as never}
    />,
  );
  assert.match(drawer, /Needs Attention/);
  assert.match(drawer, /No unambiguous cross-provider match/);
});

test("Critical Data Health is distinct and shows backend reasons", () => {
  const overview = structuredClone(fixture.overview);
  overview.health.status = "critical";
  overview.health.reasons = ["2 active providers down or without data"];
  const html = dashboard(overview);
  assert.match(html, /Data critical/);
  assert.match(html, /2 active providers down or without data/);
  assert.match(html, /bg-red-500\/10/);
});
