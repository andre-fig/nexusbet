import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardView } from "../src/components/DashboardView";
import { EventDetailView } from "../src/components/EventDetailView";
import { OddsValue } from "../src/components/OddsValue";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/monitor.json", import.meta.url), "utf8"),
);
const resource = (data: unknown) => ({
  data,
  loading: false,
  refreshing: false,
  error: null,
});

test("dashboard and detail color API odds values without native tooltips", () => {
  const detail = structuredClone(fixture.detail);
  const row = structuredClone(fixture.events.items[0]);
  const market = detail.markets[0];
  const first = market.selections[0];
  const second = market.selections[1];
  first.odds = 2.2;
  first.displayOdds = "2,20";
  second.odds = 2.1;
  second.displayOdds = "2,10";
  row.providers[0].matchWinner.displayTeamA = "2,20";
  row.providers[0].matchWinner.displayTeamB = "2,10";
  const best = {
    side: "teamA",
    selection: first.name,
    selectionId: first.id,
    marketId: market.id,
    provider: "estrelabet",
    odds: 2.2,
    displayOdds: "2,20",
    nextBestOdds: 2.05,
    displayNextBestOdds: "2,05",
    tooltip: "Highest available odd for this selection.",
  };
  const outlier = {
    ...best,
    medianOdds: 1.71,
    displayMedianOdds: "1,71",
    deviationPercent: 28.65,
    tooltip:
      "This price deviates significantly from the median across providers. Outlier: 2.20 vs provider median 1.71 (+28.7%).",
  };
  const arbitrage = {
    exists: true,
    inverseSum: 1 / 2.2 + 1 / 2.1,
    marginPercent: 7.44,
    displayMarginPercent: "7,44%",
    stakeReference: 100,
    expectedReturn: 107.44,
    legs: [
      { ...best, stakePercent: 48.84, stakeAmount: 48.84 },
      {
        ...best,
        side: "teamB",
        selectionId: second.id,
        selection: second.name,
        odds: 2.1,
        displayOdds: "2,10",
        stakePercent: 51.16,
        stakeAmount: 51.16,
      },
    ],
    tooltip: `This price is part of an arbitrage opportunity across providers. ${first.name} @ 2.20 + ${second.name} @ 2.10 yield estimated theoretical edge +7.44%. For R$100: R$48.84 on ${first.name}; R$51.16 on ${second.name}; estimated theoretical return ~R$107.44. Operational risks remain.`,
  };
  const analytics = {
    category: "match_winner",
    mapNumber: null,
    marketIds: [market.id],
    bestPrices: [best],
    outliers: [outlier],
    arbitrage,
  };
  detail.analytics = [analytics];
  market.analytics = analytics;
  row.analytics = [analytics];
  const map1 = detail.markets[1];
  const map2 = detail.markets[2];
  const mapBest = {
    ...best,
    marketId: map1.id,
    selectionId: map1.selections[0].id,
    tooltip: "Highest available odd for this selection.",
  };
  map1.analytics = {
    ...analytics,
    marketIds: [map1.id],
    bestPrices: [mapBest],
    outliers: [],
    arbitrage: null,
  };
  map2.selections[0].odds = 2.4;
  map2.selections[0].displayOdds = "2,40";
  const mapOutlier = {
    ...outlier,
    marketId: map2.id,
    selectionId: map2.selections[0].id,
    tooltip: "Outlier: 2.40 vs provider median 1.71 (+40.4%).",
  };
  map2.analytics = {
    ...analytics,
    marketIds: [map2.id],
    bestPrices: [],
    outliers: [mapOutlier],
    arbitrage: null,
  };
  const dashboard = renderToStaticMarkup(
    <DashboardView
      overview={resource(fixture.overview) as never}
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
  const matrix = renderToStaticMarkup(
    <EventDetailView
      detail={resource(detail) as never}
      history={resource(fixture.history) as never}
      raw={resource(null) as never}
      showRaw={false}
      onToggleRaw={() => {}}
      selection=""
      onSelection={() => {}}
      onBackToDashboard={() => {}}
      onSyncEvent={() => {}}
    />,
  );
  for (const html of [dashboard, matrix]) {
    assert.match(html, /aria-label="Odds 2,20, Arbitrage"/);
    assert.match(html, /text-analytics-arbitrage/);
    assert.doesNotMatch(html, /aria-label="Odds [^"]+"[^>]*title=/);
    assert.doesNotMatch(html, /BEST PRICE|OUTLIER|ARBITRAGE|★|↔/);
  }
  assert.doesNotMatch(matrix, /Arbitrage \+7,44%/);
  assert.match(matrix, /aria-label="Odds 1,83, Best price"/);
  assert.match(matrix, /text-analytics-best/);
  assert.doesNotMatch(matrix, /aria-label="Odds 1,83, Best price"[^>]*title=/);
  assert.match(matrix, /aria-label="Odds 2,40, Outlier"/);
  assert.match(matrix, /text-analytics-outlier/);
  assert.doesNotMatch(
    renderToStaticMarkup(
      <EventDetailView
        detail={resource(fixture.detail) as never}
        history={resource(fixture.history) as never}
        raw={resource(null) as never}
        showRaw={false}
        onToggleRaw={() => {}}
        selection=""
        onSelection={() => {}}
        onBackToDashboard={() => {}}
        onSyncEvent={() => {}}
      />,
    ),
    /aria-label="Odds .*Best price"/,
  );
});

test("an odds number applies Arbitrage before Outlier before Best price", () => {
  const value = (props: {
    bestPrice?: string;
    outlier?: string;
    arbitrage?: string;
  }) => renderToStaticMarkup(<OddsValue value="2,40" {...props} />);
  assert.match(value({ bestPrice: "Best price" }), /text-analytics-best/);
  assert.match(
    value({ bestPrice: "Best price", outlier: "Outlier" }),
    /text-analytics-outlier/,
  );
  const all = value({
    bestPrice: "Best price",
    outlier: "Outlier",
    arbitrage: "Arbitrage",
  });
  assert.match(all, /text-analytics-arbitrage/);
  assert.doesNotMatch(all, /title=/);
  assert.doesNotMatch(all, /★|↔|text-analytics-best|text-analytics-outlier/);
  assert.equal(value({}), "<span>2,40</span>");
});

test("odds number tooltips open on hover and keyboard focus", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://localhost:3000",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
  });
  const { render, fireEvent, cleanup } =
    await import("@testing-library/react/pure");
  try {
    const view = render(
      <OddsValue
        value="2,20"
        arbitrage="This price is part of an arbitrage opportunity across providers. For R$100: R$48.84 + R$51.16; theoretical return ~R$107.44."
      />,
    );
    const number = view.getByRole("button", { name: "Odds 2,20, Arbitrage" });
    assert.equal(number.hasAttribute("title"), false);
    fireEvent.mouseEnter(number);
    assert.match(view.getByRole("tooltip").textContent ?? "", /R\$107\.44/);
    fireEvent.mouseLeave(number);
    assert.equal(view.queryByRole("tooltip"), null);
    fireEvent.focus(number);
    assert.match(view.getByRole("tooltip").textContent ?? "", /R\$48\.84/);
    fireEvent.blur(number);
    assert.equal(view.queryByRole("tooltip"), null);
  } finally {
    cleanup();
    dom.window.close();
  }
});

test("Best price uses one short custom tooltip on hover and keyboard focus", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://localhost:3000",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
  });
  const { render, fireEvent, cleanup } =
    await import("@testing-library/react/pure");
  try {
    const view = render(
      <OddsValue
        value="1,83"
        bestPrice="Highest available odd for this selection."
      />,
    );
    const number = view.getByRole("button", { name: "Odds 1,83, Best price" });
    assert.equal(number.hasAttribute("title"), false);
    fireEvent.mouseEnter(number);
    assert.equal(
      view.getByRole("tooltip").textContent,
      "Best priceHighest available odd for this selection.",
    );
    fireEvent.mouseLeave(number);
    assert.equal(view.queryByRole("tooltip"), null);
    fireEvent.focus(number);
    assert.ok(view.getByRole("tooltip"));
  } finally {
    cleanup();
    dom.window.close();
  }
});
