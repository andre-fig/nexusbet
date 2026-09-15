import React from "react";
import { Search, ArrowRight, AlertTriangle } from "lucide-react";
import type { Overview, EventPage, Filters } from "../lib/api/types";
import type { Resource } from "../lib/api/use-resource";
import { DataState, timestamp, odd, panel, control } from "./DataState";
interface Props {
  overview: Resource<Overview>;
  events: Resource<EventPage>;
  filters: Filters;
  onFilter: (key: keyof Filters, value: string) => void;
  onOpenIssuesDrawer: () => void;
  onOpenEventDetail: (id: string) => void;
}
export function DashboardView({
  overview,
  events,
  filters,
  onFilter,
  onOpenIssuesDrawer,
  onOpenEventDetail,
}: Props) {
  const providers = overview.data?.providers ?? [],
    health = overview.data?.health,
    pagination = events.data?.pagination;
  const providerStatus = (provider: (typeof providers)[number]) => {
    if (!provider.active && provider.statusReason === "disabled_in_runtime")
      return "Disabled in this runtime";
    if (!provider.active) return "Disabled";
    if (provider.status === "unavailable") return "Unavailable";
    if (provider.status === "healthy") return "Healthy";
    return provider.status.charAt(0).toUpperCase() + provider.status.slice(1);
  };
  return (
    <div className="flex flex-col w-full px-4 md:px-6 py-4 space-y-4">
      <DataState
        loading={overview.loading && !overview.data}
        error={overview.error}
      />
      {health && (
        <div
          className={`${panel} flex flex-wrap items-center justify-between gap-3 px-4 py-2.5`}
        >
          <div className="flex flex-wrap items-center gap-4 font-mono text-[12px]">
            <span className="font-semibold capitalize text-[14px]">
              Data {health.status}
            </span>
            {([
              "events",
              "matched",
              "partial",
              "unmatched",
              "notApplicable",
            ] as const).map(
              (k) => (
                <span key={k}>
                  <b>{health[k]}</b> {k}
                </span>
              ),
            )}
          </div>
          <button
            className={`${control} text-error flex items-center gap-2`}
            onClick={onOpenIssuesDrawer}
          >
            <AlertTriangle size={14} />
            {health.issues} Needs attention
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {providers.map((p) => (
          <div key={p.id} className={`${panel} p-4 space-y-3`}>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold uppercase">
                {p.name}
              </span>
              <span
                className={`text-[11px] font-mono ${p.active && p.stale ? "text-error" : "text-on-surface-variant"}`}
              >
                {providerStatus(p)}
              </span>
            </div>
            <div className="text-[22px] font-mono font-semibold">
              {p.eventCount}{" "}
              <span className="text-[12px] font-normal text-on-surface-variant">
                {p.active ? "events" : "retained events"}
              </span>
            </div>
            <div className="text-[11px] font-mono text-on-surface-variant">
              {timestamp(p.lastUpdatedAt)}
            </div>
          </div>
        ))}
      </div>
      <div className={`${panel} flex flex-wrap gap-3 p-3`}>
        <div className="relative flex-1 min-w-60">
          <Search
            size={16}
            className="absolute left-2 top-2 text-on-surface-variant"
          />
          <input
            aria-label="Search events"
            placeholder="Search match, team or tournament..."
            className={`${control} w-full pl-8`}
            value={filters.search}
            onChange={(e) => onFilter("search", e.target.value)}
          />
        </div>
        <select
          aria-label="Esport"
          className={control}
          value={filters.esport}
          onChange={(e) => onFilter("esport", e.target.value)}
        >
          <option value="">All games</option>
          <option value="cs2">CS2</option>
          <option value="lol">LoL</option>
          <option value="valorant">Valorant</option>
        </select>
        <select
          aria-label="Matching status"
          className={control}
          value={filters.status}
          onChange={(e) => onFilter("status", e.target.value)}
        >
          <option value="">All statuses</option>
          {[
            "matched",
            "partial",
            "unmatched",
            "low_confidence",
            "not_applicable",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Start time"
          className={control}
          value={filters.start}
          onChange={(e) => onFilter("start", e.target.value)}
        >
          <option value="">All start times</option>
          <option value="today">Today (São Paulo)</option>
          <option value="24h">Next 24h</option>
          <option value="7d">Next 7 days</option>
        </select>
        <select
          aria-label="Provider"
          className={control}
          value={filters.provider}
          onChange={(e) => onFilter("provider", e.target.value)}
        >
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="text-[12px] flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.attentionOnly === "true"}
            onChange={(e) =>
              onFilter("attentionOnly", String(e.target.checked))
            }
          />
          Needs attention
        </label>
      </div>
      <div className={`${panel} overflow-hidden`}>
        <DataState
          loading={events.loading && !events.data}
          error={events.error}
          empty={events.data?.items.length === 0}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-surface-container text-on-surface-variant uppercase text-[10px] tracking-wider">
              <tr>
                {[
                  "Event / tournament",
                  "Start",
                  "Matching",
                  ...providers.map((p) => p.name),
                  "Issues",
                  "",
                ].map((h, i) => (
                  <th key={i} className="px-4 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.data?.items.map((e) => (
                <tr
                  key={e.id}
                  className="border-t border-outline-variant/20 hover:bg-surface-container/50"
                >
                  <td className="px-4 py-3">
                    <button
                      className="font-semibold hover:text-primary"
                      onClick={() => onOpenEventDetail(e.id)}
                    >
                      {e.teamA} vs {e.teamB}
                    </button>
                    <div className="text-[11px] text-on-surface-variant mt-1">
                      {e.esport.toUpperCase()} · {e.tournament}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px]">
                    {timestamp(e.startsAt)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="px-2 py-1 bg-surface-container-high rounded"
                      title={
                        e.matching.status === "not_applicable"
                          ? "Only one eligible provider is currently available."
                          : undefined
                      }
                    >
                      {e.matching.status === "not_applicable"
                        ? "Single provider"
                        : e.matching.status}
                    </span>
                    <div className="text-on-surface-variant mt-2">
                      {e.matching.providerCount}/
                      {e.matching.expectedProviderCount} providers
                    </div>
                  </td>
                  {providers.map((p) => {
                    const feed = e.providers.find((f) => f.provider === p.id);
                    return (
                      <td key={p.id} className="px-4 py-3 font-mono">
                        <div>
                          {odd(feed?.matchWinner.teamA)} /{" "}
                          {odd(feed?.matchWinner.teamB)}
                        </div>
                        <div className="text-[10px] text-on-surface-variant mt-1">
                          {!p.active
                            ? providerStatus(p)
                            : (feed?.status ?? "Not observed")}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-4 py-3">{e.issues.length}</td>
                  <td className="px-4 py-3">
                    <button
                      aria-label={`Details ${e.teamA} vs ${e.teamB}`}
                      className="text-primary"
                      onClick={() => onOpenEventDetail(e.id)}
                    >
                      <ArrowRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pagination && (
          <div className="px-4 py-3 border-t border-outline-variant/20 flex justify-between items-center text-[12px]">
            <span>
              {pagination.total} events · Page {pagination.page} /{" "}
              {pagination.pages || 1}
            </span>
            <div className="flex gap-2">
              <button
                className={control}
                disabled={pagination.page <= 1 || events.loading}
                onClick={() => onFilter("page", String(pagination.page - 1))}
              >
                Previous
              </button>
              <button
                className={control}
                disabled={pagination.page >= pagination.pages || events.loading}
                onClick={() => onFilter("page", String(pagination.page + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
