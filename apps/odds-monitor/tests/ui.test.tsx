import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { DataState } from "../src/components/DataState";
const fixture = JSON.parse(
  await readFile(new URL("./fixtures/monitor.json", import.meta.url), "utf8"),
);
test("loading, empty and error states contain no fallback records", () => {
  assert.match(
    renderToStaticMarkup(<DataState loading error={null} />),
    /Loading data/,
  );
  assert.match(
    renderToStaticMarkup(<DataState loading={false} error={null} empty />),
    /No data/,
  );
  assert.match(
    renderToStaticMarkup(<DataState loading={false} error="HTTP 503" />),
    /role="alert"/,
  );
});
test("Dashboard/detail use REST; dynamic providers, SSE, drawer, reconnect, filtering and manual refresh", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://localhost:3000",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  dom.window.scrollTo = () => {};
  const { render, fireEvent, waitFor, act, cleanup } =
    await import("@testing-library/react/pure");
  const { default: App } = await import("../src/App");
  const calls: string[] = [];
  const sources: FakeSource[] = [];
  class FakeSource extends dom.window.EventTarget {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    constructor(public url: string) {
      super();
      sources.push(this);
    }
    close() {
      this.closed = true;
    }
    emit(type: string, eventId?: string) {
      this.dispatchEvent(
        new dom.window.MessageEvent(type, {
          data: JSON.stringify({ eventId }),
        }),
      );
    }
  }
  Object.assign(globalThis, { EventSource: FakeSource });
  let failing = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const u = new URL(String(input));
    calls.push(u.pathname + u.search);
    if (failing) return new Response("", { status: 503 });
    let body: unknown;
    if (u.pathname.endsWith("/overview")) body = fixture.overview;
    else if (u.pathname.endsWith("/odds-history")) body = fixture.history;
    else if (u.pathname.endsWith("/raw")) body = { raw: { safe: true } };
    else if (u.pathname.endsWith("/issues")) body = fixture.issues;
    else if (u.pathname === "/monitor/events") body = fixture.events;
    else body = fixture.detail;
    return Response.json(body);
  };
  try {
    const screen = render(<App />);
    await waitFor(() => assert.equal(sources.length, 1));
    assert.ok(screen.getByText("Team Brute vs G2 Ares"));
    for (const p of fixture.overview.providers)
      assert.ok(screen.getAllByText(p.name).length);
    assert.ok(!screen.queryByText("Pinnacle"));
    assert.ok(calls.some((c) => c === "/monitor/overview"));
    assert.ok(calls.some((c) => c.startsWith("/monitor/events?")));
    fireEvent.click(screen.getByText("Team Brute vs G2 Ares"));
    await waitFor(() =>
      assert.ok(calls.includes("/monitor/events/" + fixture.detail.id)),
    );
    await waitFor(() => assert.ok(screen.getByText("Priority markets")));
    const selection = fixture.detail.markets[0].selections[0].id;
    fireEvent.change(screen.getByLabelText("History selection"), {
      target: { value: selection },
    });
    await waitFor(() =>
      assert.ok(calls.some((c) => c.includes("odds-history?selection="))),
    );
    const count = () =>
      calls.filter((c) => c === "/monitor/events/" + fixture.detail.id).length;
    const before = count();
    await act(async () => {
      sources[0].emit("odds.changed", "unrelated");
      await new Promise((r) => setTimeout(r, 350));
    });
    assert.equal(count(), before);
    await act(async () => {
      sources[0].emit("odds.changed", fixture.detail.id);
      await new Promise((r) => setTimeout(r, 350));
    });
    await waitFor(() => assert.ok(count() > before));
    await act(async () => sources[0].onerror?.());
    assert.ok(screen.getByText("Live updates reconnecting…"));
    const previous = count();
    fireEvent.click(screen.getByText("Sync Event"));
    await waitFor(() => assert.ok(count() > previous));
    await act(async () => {
      sources[0].onopen?.();
      sources[0].emit("ready");
      await new Promise((r) => setTimeout(r, 350));
    });
    assert.ok(screen.getByText("Live updates connected"));
    fireEvent.click(screen.getByText("Back to Dashboard"));
    fireEvent.click(screen.getByRole("button", { name: /Needs attention/ }));
    await waitFor(() => assert.ok(screen.getByRole("dialog")));
    await waitFor(() =>
      assert.ok(calls.some((c) => c.startsWith("/monitor/issues"))),
    );
    const issueCalls = calls.filter((c) =>
      c.startsWith("/monitor/issues"),
    ).length;
    await act(async () => {
      sources[0].emit("issue.created");
      await new Promise((r) => setTimeout(r, 350));
    });
    await waitFor(() =>
      assert.ok(
        calls.filter((c) => c.startsWith("/monitor/issues")).length >
          issueCalls,
      ),
    );
    fireEvent.click(screen.getByLabelText("Close issues"));
    fireEvent.change(screen.getByLabelText("Esport"), {
      target: { value: "cs2" },
    });
    await waitFor(() => assert.ok(calls.some((c) => c.includes("esport=cs2"))));
    const overviewCalls = calls.filter((c) => c === "/monitor/overview").length;
    await act(async () => {
      sources[0].emit("provider.updated");
      await new Promise((r) => setTimeout(r, 350));
    });
    await waitFor(() =>
      assert.ok(
        calls.filter((c) => c === "/monitor/overview").length > overviewCalls,
      ),
    );
    failing = true;
    fireEvent.click(screen.getByTitle("Manual Sync"));
    await waitFor(() => assert.ok(screen.getAllByRole("alert").length));
    assert.ok(screen.getByText("Team Brute vs G2 Ares"));
    screen.unmount();
    assert.ok(sources[0].closed);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
