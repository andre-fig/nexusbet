import React, { useEffect, useRef, useState } from "react";
import { Header } from "./components/Header";
import { DashboardView } from "./components/DashboardView";
import { EventDetailView } from "./components/EventDetailView";
import { NeedsAttentionDrawer } from "./components/NeedsAttentionDrawer";
import { Footer } from "./components/Footer";
import { monitor } from "./lib/api/monitor";
import { useResource } from "./lib/api/use-resource";
import type { Filters } from "./lib/api/types";
import {
  connectStream,
  invalidations,
  type Invalidation,
} from "./lib/sse/monitor-stream";
const initialVersions = {
  overview: 0,
  events: 0,
  detail: 0,
  issues: 0,
  history: 0,
  raw: 0,
};
export default function App() {
  const [versions, setVersions] = useState(initialVersions),
    [selected, setSelected] = useState<string | null>(null),
    [view, setView] = useState<"dashboard" | "event-detail">("dashboard"),
    [drawer, setDrawer] = useState(false),
    [dark, setDark] = useState(true),
    [showRaw, setShowRaw] = useState(false),
    [selection, setSelection] = useState(""),
    [live, setLive] = useState<"connected" | "reconnecting">("reconnecting");
  const [filters, setFilters] = useState<Filters>({
    search: "",
    esport: "",
    status: "",
    start: "",
    provider: "",
    attentionOnly: "false",
    page: "1",
    limit: "50",
  });
  const active = useRef<string | null>(null);
  active.current = view === "event-detail" ? selected : null;
  const overview = useResource(
      (s) => monitor.overview(s),
      String(versions.overview),
      true,
      "overview",
    ),
    events = useResource(
      (s) => monitor.events(filters, s),
      JSON.stringify(filters) + versions.events,
      true,
      JSON.stringify(filters),
    ),
    detail = useResource(
      (s) => monitor.detail(selected!, s),
      selected + ":" + versions.detail,
      view === "event-detail" && !!selected,
      selected ?? "",
    ),
    issues = useResource(
      (s) => monitor.issues(s),
      String(versions.issues),
      drawer,
      "issues",
    ),
    history = useResource(
      (s) => monitor.history(selected!, { selection }, s),
      selected + ":" + selection + ":" + versions.history,
      view === "event-detail" && !!selected && !!selection,
      selected + ":" + selection,
    ),
    raw = useResource(
      (s) => monitor.raw(selected!, s),
      selected + ":" + versions.raw,
      view === "event-detail" && !!selected && showRaw,
      selected ?? "",
    );
  const bump = (keys: Invalidation[]) =>
    setVersions((v) => {
      const next = { ...v };
      for (const k of new Set(keys)) next[k]++;
      return next;
    });
  const initialized = !overview.loading && !events.loading;
  const [streamStarted, setStreamStarted] = useState(false);
  useEffect(() => {
    if (initialized) setStreamStarted(true);
  }, [initialized]);
  useEffect(() => {
    if (!streamStarted) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<Invalidation>();
    const close = connectStream((type, data) => {
      for (const key of invalidations(type, data.eventId, active.current))
        pending.add(key);
      if (!timer)
        timer = setTimeout(() => {
          bump([...pending]);
          pending.clear();
          timer = undefined;
        }, 300);
    }, setLive);
    return () => {
      close();
      clearTimeout(timer);
    };
  }, [streamStarted]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const open = (id: string) => {
    setSelected(id);
    setView("event-detail");
    setSelection("");
    setShowRaw(false);
    setDrawer(false);
    window.scrollTo({ top: 0 });
  };
  const sync = () =>
    bump(
      view === "dashboard"
        ? [
            "overview",
            "events",
            ...(drawer ? (["issues"] as Invalidation[]) : []),
          ]
        : [
            "detail",
            ...(selection ? (["history"] as Invalidation[]) : []),
            ...(showRaw ? (["raw"] as Invalidation[]) : []),
            ...(drawer ? (["issues"] as Invalidation[]) : []),
          ],
    );
  const isSyncing =
    view === "dashboard"
      ? overview.loading ||
        overview.refreshing ||
        events.loading ||
        events.refreshing
      : detail.loading ||
        detail.refreshing ||
        history.refreshing ||
        raw.refreshing;
  return (
    <div className="min-h-screen flex flex-col bg-surface-container-lowest text-on-surface antialiased transition-colors duration-200">
      <Header
        currentView={view}
        onNavigate={setView}
        onSync={sync}
        isSyncing={isSyncing}
        isDarkMode={dark}
        onToggleTheme={() => setDark(!dark)}
        liveStatus={
          live === "connected"
            ? "Live updates connected"
            : "Live updates reconnecting…"
        }
        eventTitle={
          detail.data
            ? `${detail.data.teamA} vs ${detail.data.teamB}`
            : undefined
        }
      />
      <main className="flex-1 pt-14">
        {view === "dashboard" ? (
          <DashboardView
            overview={overview}
            events={events}
            filters={filters}
            onFilter={(key, value) =>
              setFilters((f) => ({
                ...f,
                [key]: value,
                page: key === "page" ? value : "1",
              }))
            }
            onOpenIssuesDrawer={() => setDrawer(true)}
            onOpenEventDetail={open}
          />
        ) : (
          <EventDetailView
            key={selected}
            detail={detail}
            history={history}
            raw={raw}
            showRaw={showRaw}
            onToggleRaw={() => setShowRaw(!showRaw)}
            selection={selection}
            onSelection={setSelection}
            onBackToDashboard={() => setView("dashboard")}
            onSyncEvent={sync}
          />
        )}
      </main>
      <Footer />
      <NeedsAttentionDrawer
        isOpen={drawer}
        onClose={() => setDrawer(false)}
        issues={issues}
        onInspectIssue={open}
      />
    </div>
  );
}
