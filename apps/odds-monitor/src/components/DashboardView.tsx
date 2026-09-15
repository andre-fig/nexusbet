import React from "react";
import { Search, ArrowRight, AlertTriangle } from "lucide-react";
import type { Overview, EventPage, Filters } from "../lib/api/types";
import type { Resource } from "../lib/api/use-resource";
import { DataState, timestamp, panel, control } from "./DataState";
import { OddsValue } from "./OddsValue";
import {
  healthStatusColor,
  ProviderStatus,
  providerStatusPresentation,
} from "../lib/api/status";
import {
  MatchingStatus,
  matchingFilterStatuses,
  matchingStatusColors,
} from "../lib/api/matching-status";
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
    tableProviders = providers.filter((provider) => provider.eventCount > 0),
    health = overview.data?.health,
    pagination = events.data?.pagination;
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
            <span
              className={`font-semibold capitalize text-[14px] ${healthStatusColor(health.status)}`}
              title={
                health.reasons?.length
                  ? health.reasons.join("; ")
                  : "Active providers and systemic quality are healthy. Event-level issues remain in Needs attention."
              }
            >
              Data {health.status}
            </span>
            {(
              [
                { key: "events", status: undefined },
                { key: "matched", status: MatchingStatus.Matched },
                { key: "partial", status: MatchingStatus.Partial },
                { key: "unmatched", status: MatchingStatus.Unmatched },
                { key: "notApplicable", status: MatchingStatus.NotApplicable },
              ] as const
            ).map(({ key, status }) => (
              <span
                key={key}
                className={
                  status
                    ? `px-2 py-1 rounded ${matchingStatusColors(status)}`
                    : undefined
                }
              >
                <b>{health[key]}</b> {key === "events" ? "current events" : key}
              </span>
            ))}
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
        {providers.map((p) => {
          const status = providerStatusPresentation(p);
          return (
            <div key={p.id} className={`${panel} p-4 space-y-3`}>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold uppercase">
                  {p.name}
                </span>
                <span className={`text-[11px] font-mono ${status.color}`}>
                  {status.label}
                </span>
              </div>
              <div className="text-[22px] font-mono font-semibold">
                {p.eventCount}{" "}
                <span className="text-[12px] font-normal text-on-surface-variant">
                  {p.status === ProviderStatus.Healthy ||
                  (p.status === ProviderStatus.Degraded && !p.stale)
                    ? "listed events"
                    : "retained events"}
                </span>
              </div>
              <div className="text-[11px] font-mono text-on-surface-variant">
                {timestamp(p.lastUpdatedAt)}
              </div>
            </div>
          );
        })}
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
          {matchingFilterStatuses.map((s) => (
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
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-surface-container text-on-surface-variant uppercase text-[10px] tracking-wider">
              <tr>
                {[
                  "Event / tournament",
                  "Start",
                  "Matching",
                  ...tableProviders.map((p) => p.name),
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
              {events.data?.items.length === 0 && (
                <tr>
                  <td colSpan={tableProviders.length + 5}>
                    {health?.events === 0 &&
                    providers.some((provider) => provider.eventCount > 0) ? (
                      <div className="p-8 text-center text-on-surface-variant">
                        No fresh events available. Retained provider events are
                        shown above for diagnosis and do not enter current
                        matching.
                      </div>
                    ) : (
                      <DataState loading={false} error={null} empty />
                    )}
                  </td>
                </tr>
              )}
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
                      className={`px-2 py-1 rounded ${matchingStatusColors(e.matching.status)}`}
                      title={
                        e.matching.status === MatchingStatus.NotApplicable
                          ? "Only one eligible provider is currently available."
                          : undefined
                      }
                    >
                      {e.matching.status === MatchingStatus.NotApplicable
                        ? "Single provider"
                        : e.matching.status}
                    </span>
                    <div className="text-on-surface-variant mt-2">
                      {e.matching.providerCount}/
                      {e.matching.expectedProviderCount} providers
                    </div>
                  </td>
                  {tableProviders.map((p) => {
                    const feed = e.providers.find((f) => f.provider === p.id);
                    const winner = e.analytics?.find(
                      (analysis) => analysis.category === "match_winner",
                    );
                    const status = !p.active
                      ? providerStatusPresentation(p)
                      : feed
                        ? providerStatusPresentation({
                            ...feed,
                            status:
                              feed.matchWinner.status === ProviderStatus.Stale
                                ? ProviderStatus.Stale
                                : feed.status,
                          })
                        : null;
                    return (
                      <td key={p.id} className="px-4 py-3 font-mono">
                        <div className="flex flex-wrap items-center gap-1">
                          {(["teamA", "teamB"] as const).map((side, index) => {
                            const best = winner?.bestPrices.find(
                              (item) =>
                                item.side === side && item.provider === p.id,
                            );
                            const outlier = winner?.outliers.find(
                              (item) =>
                                item.side === side && item.provider === p.id,
                            );
                            return (
                              <span
                                key={side}
                                className="inline-flex items-center gap-0.5"
                              >
                                {index === 1 && (
                                  <span className="text-on-surface-variant mr-0.5">
                                    /
                                  </span>
                                )}
                                <OddsValue
                                  value={
                                    side === "teamA"
                                      ? feed?.matchWinner.displayTeamA
                                      : feed?.matchWinner.displayTeamB
                                  }
                                  bestPrice={best?.tooltip}
                                  outlier={outlier?.tooltip}
                                  arbitrage={
                                    winner?.arbitrage?.legs.some(
                                      (leg) =>
                                        leg.side === side &&
                                        leg.provider === p.id,
                                    )
                                      ? winner.arbitrage.tooltip
                                      : undefined
                                  }
                                />
                              </span>
                            );
                          })}
                        </div>
                        {feed?.matchWinner.status === "unavailable" && (
                          <div
                            className="text-[10px] text-on-surface-variant"
                            title="This provider has not observed a Match winner market. Its other markets remain available."
                          >
                            Market unavailable
                          </div>
                        )}
                        <div
                          className={`text-[10px] mt-1 ${status?.color ?? "text-on-surface-variant"}`}
                          title={
                            feed?.matchWinner.status === ProviderStatus.Stale
                              ? "This market exceeded the freshness TTL. The last observed odds are shown for diagnosis and excluded from comparisons."
                              : undefined
                          }
                        >
                          {status?.label ?? "Not observed"}
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
