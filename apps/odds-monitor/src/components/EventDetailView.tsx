import React from "react";
import { providerStatusPresentation } from "../lib/api/status";
import {
  MatchingStatus,
  matchingStatusColors,
} from "../lib/api/matching-status";
import { ArrowLeft, RefreshCw, Code2 } from "lucide-react";
import type { Detail, History } from "../lib/api/types";
import type { Resource } from "../lib/api/use-resource";
import { DataState, timestamp, odd, panel, control } from "./DataState";
import { AnalyticsBadge } from "./AnalyticsBadge";
interface Props {
  detail: Resource<Detail>;
  history: Resource<History>;
  raw: Resource<unknown>;
  showRaw: boolean;
  onToggleRaw: () => void;
  selection: string;
  onSelection: (id: string) => void;
  onBackToDashboard: () => void;
  onSyncEvent: () => void;
}
export function EventDetailView({
  detail,
  history,
  raw,
  showRaw,
  onToggleRaw,
  selection,
  onSelection,
  onBackToDashboard,
  onSyncEvent,
}: Props) {
  const event = detail.data;
  const options =
    event?.markets.flatMap((m) =>
      m.selections.map((s) => ({
        id: s.id,
        label: `${m.provider} · ${m.name} · ${s.name}`,
      })),
    ) ?? [];
  return (
    <div className="flex flex-col w-full px-4 md:px-6 py-4 space-y-5 max-w-7xl mx-auto">
      <div className="flex justify-between gap-3">
        <button
          onClick={onBackToDashboard}
          className="flex gap-2 items-center uppercase text-[11px] text-on-surface-variant"
        >
          <ArrowLeft size={14} />
          Back to Dashboard
        </button>
        <div className="flex gap-2">
          <button
            className={`${control} flex items-center gap-2`}
            onClick={onSyncEvent}
          >
            <RefreshCw size={14} />
            Sync Event
          </button>
          <button
            className={`${control} flex items-center gap-2`}
            onClick={onToggleRaw}
          >
            <Code2 size={14} />
            Raw JSON
          </button>
        </div>
      </div>
      <DataState loading={detail.loading} error={detail.error} />
      {event && (
        <>
          <div className={`${panel} p-5 flex flex-wrap justify-between gap-4`}>
            <div>
              <h1 className="text-[22px] font-bold tracking-tight">
                {event.teamA} vs {event.teamB}
              </h1>
              <div className="text-[12px] text-on-surface-variant mt-2">
                {event.esport.toUpperCase()} · {event.tournament} ·{" "}
                {timestamp(event.startsAt)}
              </div>
              <div className="font-mono text-[10px] text-on-surface-variant mt-2">
                {event.canonicalId
                  ? "Canonical event"
                  : event.matching.status === MatchingStatus.NotApplicable
                    ? "Single-provider event"
                    : "Unmatched provider event"}
                : {event.id}
              </div>
            </div>
            <div className="text-right">
              <div
                className={`inline-block px-2 py-1 rounded ${matchingStatusColors(event.matching.status)} uppercase text-[12px] font-semibold`}
                title={
                  event.matching.status === MatchingStatus.NotApplicable
                    ? "Only one eligible provider is currently available."
                    : undefined
                }
              >
                {event.matching.status === MatchingStatus.NotApplicable
                  ? "Matching unavailable"
                  : event.matching.status}
              </div>
              <div className="text-[12px] mt-2">
                Confidence: {(event.matching.confidence * 100).toFixed(0)}%
              </div>
              <div className="text-[11px] text-on-surface-variant mt-1">
                {event.matching.providerCount}/
                {event.matching.expectedProviderCount} providers
              </div>
            </div>
          </div>
          <section className={`${panel} overflow-hidden`}>
            <h2 className="p-4 text-[14px] font-semibold border-b border-outline-variant/20">
              Ingested feeds
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-surface-container text-on-surface-variant">
                  <tr>
                    {[
                      "Provider",
                      "External ID",
                      "Raw teams / tournament",
                      "Provider start",
                      "Last update",
                      "Data status",
                    ].map((h) => (
                      <th className="p-3" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {event.providers.map((p) => {
                    const status = providerStatusPresentation(p);
                    return (
                      <tr
                        key={p.id}
                        className="border-t border-outline-variant/20"
                      >
                        <td className="p-3 font-semibold">{p.provider}</td>
                        <td className="p-3 font-mono">{p.providerEventId}</td>
                        <td className="p-3">
                          {p.rawTeamA} vs {p.rawTeamB}
                          <div className="text-on-surface-variant text-[11px]">
                            {p.rawTournament}
                          </div>
                        </td>
                        <td className="p-3">{timestamp(p.startsAt)}</td>
                        <td className="p-3">{timestamp(p.lastUpdatedAt)}</td>
                        <td className={`p-3 ${status.color}`}>
                          {status.label}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className={`${panel} overflow-hidden`}>
            <h2 className="p-4 text-[14px] font-semibold border-b border-outline-variant/20">
              Priority markets
            </h2>
            <DataState
              loading={false}
              error={null}
              empty={!event.markets.length}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="bg-surface-container text-on-surface-variant">
                  <tr>
                    {[
                      "Market / selection",
                      ...event.providers.map((p) => p.provider),
                    ].map((h) => (
                      <th className="p-3" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[null, 1, 2, 3].flatMap((map) => {
                    const markets = event.markets.filter((m) =>
                      map === null
                        ? m.category === "match_winner"
                        : m.category === "map_winner" && m.mapNumber === map,
                    );
                    if (!markets.length) return [];
                    const arbitrage = markets.find(
                      (m) => m.analytics?.arbitrage?.exists,
                    )?.analytics?.arbitrage;
                    return [
                      <tr
                        key={String(map)}
                        className="border-t border-outline-variant/20"
                      >
                        <td className="p-3 font-semibold">
                          {map === null ? "Match winner" : `Map ${map} winner`}
                          {arbitrage && (
                            <span className="ml-2 inline-flex">
                              <AnalyticsBadge
                                kind="arbitrage"
                                label={`Arbitrage +${arbitrage.displayMarginPercent}`}
                                tooltip={arbitrage.tooltip}
                              />
                            </span>
                          )}
                        </td>
                        {event.providers.map((p) => (
                          <td className="p-3" key={p.provider}>
                            {markets
                              .filter((m) => m.provider === p.provider)
                              .map((m) => (
                                <div key={m.id}>
                                  {m.selections.map((s) => {
                                    const best = m.analytics?.bestPrices.find(
                                      (price) => price.selectionId === s.id,
                                    );
                                    const outlier = m.analytics?.outliers.find(
                                      (item) => item.selectionId === s.id,
                                    );
                                    return (
                                      <div
                                        key={s.id}
                                        className="flex gap-3 justify-between py-1"
                                      >
                                        <span>{s.name}</span>
                                        <span className="font-mono inline-flex items-center gap-1">
                                          {odd(s.displayOdds)}
                                          {best && (
                                            <AnalyticsBadge
                                              kind="best_price"
                                              tooltip={best.tooltip}
                                            />
                                          )}
                                          {outlier && (
                                            <AnalyticsBadge
                                              kind="outlier"
                                              tooltip={outlier.tooltip}
                                            />
                                          )}
                                          {s.status && s.status !== "healthy"
                                            ? ` · ${s.status}`
                                            : ""}
                                        </span>
                                      </div>
                                    );
                                  })}
                                  <span className="text-[10px] text-on-surface-variant">
                                    {m.providerMarketId}
                                  </span>
                                </div>
                              ))}
                          </td>
                        ))}
                      </tr>,
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className={`${panel} p-4 space-y-3`}>
            <div className="flex flex-wrap justify-between gap-3">
              <h2 className="text-[14px] font-semibold">Odds history</h2>
              <select
                aria-label="History selection"
                className={control}
                value={selection}
                onChange={(e) => onSelection(e.target.value)}
              >
                <option value="">Select provider / market / selection</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <DataState
              loading={history.loading}
              error={history.error}
              empty={!!selection && history.data?.series.length === 0}
            />
            {!selection && (
              <p className="text-[12px] text-on-surface-variant">
                Select a runner to load its recorded observations.
              </p>
            )}
            {history.data?.truncated && (
              <p className="text-error text-[12px]">
                First 2,000 observations shown. Narrow the time range through
                the history API.
              </p>
            )}
            {history.data?.series.map((s) => (
              <div key={s.selectionId}>
                <HistoryChart points={s.points} />
                <div className="max-h-44 overflow-y-auto">
                  <table className="w-full text-[12px] text-left">
                    <thead>
                      <tr>
                        <th className="p-2">Observed at</th>
                        <th className="p-2">Odds</th>
                        <th className="p-2">Suspended / in-play</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.points.map((p, i) => (
                        <tr
                          key={i}
                          className="border-t border-outline-variant/20"
                        >
                          <td className="p-2 font-mono">
                            {timestamp(p.fetchedAt)}
                          </td>
                          <td className="p-2 font-mono">
                            {odd(p.displayOdds)}
                          </td>
                          <td className="p-2">
                            {String(p.suspended)} / {String(p.inPlay)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
          <section className={`${panel} p-4`}>
            <h2 className="text-[14px] font-semibold mb-3">Data issues</h2>
            {event.issues.length ? (
              event.issues.map((i) => (
                <div
                  key={i.id}
                  className="py-2 border-t border-outline-variant/20 text-[12px]"
                >
                  <span className="text-error">
                    {i.severity} · {i.type}
                  </span>
                  <p>{i.message}</p>
                </div>
              ))
            ) : (
              <p className="text-[12px] text-on-surface-variant">
                No open issues for this event.
              </p>
            )}
          </section>
          {showRaw && (
            <section className={`${panel} p-4`}>
              <h2 className="font-semibold text-[14px] mb-3">
                Sanitized raw data
              </h2>
              <DataState loading={raw.loading} error={raw.error} />
              {!!raw.data && (
                <pre className="overflow-auto max-h-96 text-[11px] font-mono">
                  {JSON.stringify(raw.data, null, 2)}
                </pre>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
function HistoryChart({
  points,
}: {
  points: History["series"][number]["points"];
}) {
  const valid = points.filter((p) => p.odds !== null);
  if (!valid.length) return null;
  const times = valid.map((p) => Date.parse(p.fetchedAt)),
    values = valid.map((p) => p.odds!),
    minT = Math.min(...times),
    maxT = Math.max(...times),
    min = Math.min(...values),
    max = Math.max(...values);
  const xy = (p: (typeof points)[number]) =>
    `${20 + ((Date.parse(p.fetchedAt) - minT) / (maxT - minT || 1)) * 760},${140 - ((p.odds! - min) / (max - min || 1)) * 110}`;
  return (
    <svg
      role="img"
      aria-label="Observed odds history"
      viewBox="0 0 800 170"
      className="w-full h-44 text-primary"
    >
      <path
        d="M20 15 V145 H790"
        stroke="currentColor"
        opacity=".2"
        fill="none"
      />
      <text x="22" y="12" fontSize="10" fill="currentColor">
        {odd(valid.find((p) => p.odds === max)?.displayOdds)}
      </text>
      <text x="22" y="158" fontSize="10" fill="currentColor">
        {timestamp(valid[0].fetchedAt)}
      </text>
      <text x="780" y="158" textAnchor="end" fontSize="10" fill="currentColor">
        {timestamp(valid[valid.length - 1].fetchedAt)}
      </text>
      {points.map(
        (p, i) =>
          p.odds !== null && (
            <circle
              key={i}
              cx={xy(p).split(",")[0]}
              cy={xy(p).split(",")[1]}
              r="3"
              fill="currentColor"
            >
              <title>{`${timestamp(p.fetchedAt)}: ${odd(p.displayOdds)}`}</title>
            </circle>
          ),
      )}
    </svg>
  );
}
