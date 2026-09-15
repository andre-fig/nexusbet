import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardView } from "../src/components/DashboardView";
import { EventDetailView } from "../src/components/EventDetailView";
import { AnalyticsBadge } from "../src/components/AnalyticsBadge";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/monitor.json", import.meta.url), "utf8"),
);
const resource = (data: unknown) => ({
  data,
  loading: false,
  refreshing: false,
  error: null,
});

test("dashboard and detail show API analytics badges with contextual tooltips", () => {
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
    tooltip: `Best price: EstrelaBet oferece 2,20 para ${first.name}; a próxima melhor é 2,05.`,
  };
  const outlier = {
    ...best,
    medianOdds: 1.71,
    displayMedianOdds: "1,71",
    deviationPercent: 28.65,
    tooltip:
      "EstrelaBet oferece 2,20. Mediana dos providers: 1,71. Diferença: +28,7%.",
  };
  const arbitrage = {
    exists: true,
    inverseSum: 1 / 2.2 + 1 / 2.1,
    marginPercent: 7.44,
    displayMarginPercent: "7,44%",
    stakeReference: 100,
    expectedReturn: 107.44,
    legs: [],
    tooltip: `${first.name} @ 2,20 + ${second.name} @ 2,10 formam arbitragem teórica de 7,44%. Para R$100: R$48,84 em ${first.name}; R$51,16 em ${second.name}; retorno teórico ~R$107,44. Risco operacional ainda existe: mudança de odds, limites, void ou regras diferentes.`,
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
    assert.match(html, /aria-label="BEST PRICE"/);
    assert.match(html, /aria-label="OUTLIER"/);
    assert.match(html, /aria-label="ARBITRAGE"/);
    assert.match(html, /a próxima melhor é 2,05/);
    assert.match(html, /Mediana dos providers: 1,71/);
    assert.match(html, /Para R\$100/);
    assert.match(html, /Risco operacional ainda existe/);
  }
  assert.match(matrix, /Arbitrage \+7,44%/);
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
    /aria-label="BEST PRICE"/,
  );
});

test("analytics tooltips open on hover and keyboard focus", async () => {
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
      <AnalyticsBadge
        kind="arbitrage"
        tooltip="Para R$100: R$48,84 + R$51,16; retorno teórico ~R$107,44."
      />,
    );
    const badge = view.getByRole("button", { name: "ARBITRAGE" });
    fireEvent.mouseEnter(badge);
    assert.match(view.getByRole("tooltip").textContent ?? "", /R\$107,44/);
    fireEvent.mouseLeave(badge);
    assert.equal(view.queryByRole("tooltip"), null);
    fireEvent.focus(badge);
    assert.match(view.getByRole("tooltip").textContent ?? "", /R\$48,84/);
    fireEvent.blur(badge);
    assert.equal(view.queryByRole("tooltip"), null);
  } finally {
    cleanup();
    dom.window.close();
  }
});
