import React, { useState, useMemo } from 'react';
import { 
  Search, 
  ArrowRight, 
  ChevronRight, 
  AlertTriangle, 
  CheckCircle2, 
  AlertCircle,
  HelpCircle,
  Clock,
  ExternalLink
} from 'lucide-react';
import { ProviderMetric, OperationalOddsEvent, GameCategory, StatusFilter, TimeFilter } from '../types';

interface DashboardViewProps {
  providers: ProviderMetric[];
  events: OperationalOddsEvent[];
  onOpenIssuesDrawer: () => void;
  onOpenEventDetail: (eventId: string) => void;
  onOpenInspectionModal: (event: OperationalOddsEvent) => void;
  issueCount: number;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  providers,
  events,
  onOpenIssuesDrawer,
  onOpenEventDetail,
  onOpenInspectionModal,
  issueCount,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGame, setSelectedGame] = useState<GameCategory>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('ALL');
  const [selectedTime, setSelectedTime] = useState<TimeFilter>('TODAY');

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      // Game filter
      if (selectedGame !== 'ALL' && ev.game !== selectedGame) {
        return false;
      }
      // Status filter
      if (selectedStatus === 'ATTENTION' && ev.status !== 'ATTENTION') {
        return false;
      }
      if (selectedStatus === 'MATCHED' && ev.status !== 'MATCHED') {
        return false;
      }
      if (selectedStatus === 'PARTIAL' && ev.status !== 'PARTIAL') {
        return false;
      }
      if (selectedStatus === 'UNMATCHED' && ev.status !== 'UNMATCHED') {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inMatch = ev.matchName.toLowerCase().includes(q);
        const inTourn = ev.tournament.toLowerCase().includes(q);
        const inGame = ev.game.toLowerCase().includes(q);
        return inMatch || inTourn || inGame;
      }

      return true;
    });
  }, [events, selectedGame, selectedStatus, searchQuery]);

  const handleRowAction = (ev: OperationalOddsEvent) => {
    if (ev.id === 'iem-cologne-2025-m39' || ev.actionType === 'details') {
      onOpenEventDetail(ev.id);
    } else {
      onOpenInspectionModal(ev);
    }
  };

  return (
    <div className="flex flex-col w-full px-4 md:px-6 py-4 space-y-4">
      {/* TOP SUMMARY STATUS BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-container-low px-4 py-2.5 rounded-lg shadow-sm border border-outline-variant/20">
        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          <div className="flex items-center gap-2 px-3 py-1 rounded bg-surface-container-high text-on-surface">
            <span className="w-2 h-2 rounded-full bg-primary-container"></span>
            <span className="font-semibold text-[14px] tracking-tight text-on-surface">Data Healthy</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[12px] text-on-surface-variant">
            <span className="text-on-surface font-semibold">68</span> events
            <span className="text-on-surface-variant/40">·</span>
            <span className="text-on-surface font-semibold">61</span> matched
            <span className="text-on-surface-variant/40">·</span>
            <span className="text-on-surface font-semibold">4</span> partial
            <span className="text-on-surface-variant/40">·</span>
            <span className="text-on-surface font-semibold">3</span> unmatched
          </div>
        </div>

        {/* Alert Trigger Pill */}
        <button
          onClick={onOpenIssuesDrawer}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded bg-surface-container-highest text-on-surface hover:bg-surface-bright transition-all cursor-pointer border border-outline-variant/30"
          type="button"
        >
          <span className="w-2 h-2 rounded-full bg-error animate-pulse"></span>
          <span className="text-[13px] text-on-surface font-semibold">{issueCount} need attention:</span>
          <span className="font-mono text-[11px] text-on-surface-variant hidden sm:inline">
            3 unmatched · 2 divergence · 1 stale · 1 invalid
          </span>
          <span className="text-[12px] text-primary flex items-center font-medium ml-1">
            View issues <ArrowRight size={13} className="ml-1" />
          </span>
        </button>
      </div>

      {/* DYNAMIC PROVIDERS METRICS ROW */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {providers.map((p) => (
          <div
            key={p.id}
            className="bg-surface-container-low p-4 rounded-lg flex flex-col justify-between space-y-2 shadow-sm border border-outline-variant/20 hover:border-outline-variant/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-on-surface tracking-wider font-semibold uppercase">{p.name}</span>
              <div
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[11px] ${
                  p.isStale
                    ? 'bg-error-container/20 text-error font-medium'
                    : 'bg-surface-container text-on-surface'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    p.isStale ? 'bg-error animate-ping' : 'bg-primary-container'
                  }`}
                ></span>
                <span>{p.status}</span>
              </div>
            </div>

            <div className="flex items-baseline justify-between mt-1">
              <div className="text-[22px] text-on-surface font-mono font-semibold tracking-tight">
                {p.eventCount} <span className="text-[12px] font-normal text-on-surface-variant">events</span>
              </div>
              <div className={`font-mono text-[11px] ${p.isStale ? 'text-error font-medium' : 'text-on-surface-variant'}`}>
                {p.lastUpdate}
              </div>
            </div>

            <div className="w-full bg-surface-container rounded-full h-1 mt-1 overflow-hidden">
              <div
                className={`h-1 rounded-full ${p.isStale ? 'bg-error' : 'bg-primary-container'}`}
                style={{ width: `${p.percent}%` }}
              ></div>
            </div>
          </div>
        ))}
      </div>

      {/* FILTER & SEARCH BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-container-low p-3 rounded-lg shadow-sm border border-outline-variant/20">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          {/* Search Input */}
          <div className="relative min-w-[240px] max-w-sm flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-[16px]" size={16} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-8 pl-8 pr-3 bg-surface-container text-on-surface placeholder-on-surface-variant/60 text-[13px] rounded border border-transparent focus:border-outline-variant focus:outline-none transition-colors"
              placeholder="Search match, team or tournament..."
              type="text"
            />
          </div>

          <div className="h-5 w-px bg-surface-variant hidden md:block"></div>

          {/* Game filter group */}
          <div className="flex items-center gap-1 bg-surface-container p-0.5 rounded">
            {(['ALL', 'CS2', 'LoL', 'VAL'] as GameCategory[]).map((g) => (
              <button
                key={g}
                onClick={() => setSelectedGame(g)}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold tracking-wider uppercase transition-colors ${
                  selectedGame === g
                    ? 'bg-surface-bright text-on-surface shadow-xs font-bold'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          {/* Status filter buttons */}
          <div className="flex items-center gap-1 bg-surface-container p-0.5 rounded overflow-x-auto">
            <button
              onClick={() => setSelectedStatus('ALL')}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold tracking-wider uppercase transition-colors whitespace-nowrap ${
                selectedStatus === 'ALL'
                  ? 'bg-surface-bright text-on-surface shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
              }`}
            >
              All Status
            </button>
            <button
              onClick={() => setSelectedStatus('ATTENTION')}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold tracking-wider uppercase transition-colors whitespace-nowrap ${
                selectedStatus === 'ATTENTION'
                  ? 'bg-error-container text-error font-bold'
                  : 'text-error hover:bg-surface-container-high'
              }`}
            >
              Needs Attention ({issueCount})
            </button>
            <button
              onClick={() => setSelectedStatus('MATCHED')}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold tracking-wider uppercase transition-colors whitespace-nowrap ${
                selectedStatus === 'MATCHED'
                  ? 'bg-surface-bright text-on-surface shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
              }`}
            >
              Matched
            </button>
            <button
              onClick={() => setSelectedStatus('PARTIAL')}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold tracking-wider uppercase transition-colors whitespace-nowrap ${
                selectedStatus === 'PARTIAL'
                  ? 'bg-surface-bright text-on-surface shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
              }`}
            >
              Partial
            </button>
            <button
              onClick={() => setSelectedStatus('UNMATCHED')}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold tracking-wider uppercase transition-colors whitespace-nowrap ${
                selectedStatus === 'UNMATCHED'
                  ? 'bg-surface-bright text-on-surface shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
              }`}
            >
              Unmatched
            </button>
          </div>
        </div>

        {/* Time window pills */}
        <div className="flex items-center gap-1 bg-surface-container p-0.5 rounded">
          {(['TODAY', '24H', '7D'] as TimeFilter[]).map((t) => (
            <button
              key={t}
              onClick={() => setSelectedTime(t)}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold tracking-wider uppercase transition-colors ${
                selectedTime === t
                  ? 'bg-surface-bright text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
              }`}
            >
              {t === 'TODAY' ? 'Today' : t === '24H' ? '24h' : '7d'}
            </button>
          ))}
        </div>
      </div>

      {/* MAIN OPERATIONAL ODDS TABLE */}
      <div className="w-full bg-surface-container-low rounded-lg shadow-sm overflow-hidden flex flex-col border border-outline-variant/20">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest h-9 text-[11px] text-on-surface-variant font-semibold uppercase tracking-wider border-b border-outline-variant/20">
                <th className="px-4 py-2 w-16">Game</th>
                <th className="px-4 py-2 min-w-[220px]">Match &amp; Tournament</th>
                <th className="px-4 py-2 w-28">Start</th>
                <th className="px-4 py-2 text-right min-w-[130px]">Bet365</th>
                <th className="px-4 py-2 text-right min-w-[130px]">Betano</th>
                <th className="px-4 py-2 text-right min-w-[130px]">Superbet</th>
                <th className="px-4 py-2 text-right min-w-[130px]">Pinnacle</th>
                <th className="px-4 py-2 min-w-[160px]">Integrity Status</th>
                <th className="px-4 py-2 text-right w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-highest/20 text-[13px]">
              {filteredEvents.map((ev) => {
                const isDivergentRow = ev.superbet.isDivergent;
                const isInvalidRow = ev.bet365.isInvalid;
                const isUnmatchedRow = ev.status === 'UNMATCHED';

                let rowBgClass = 'hover:bg-surface-container/70';
                if (isDivergentRow) rowBgClass = 'bg-secondary-container/20 hover:bg-secondary-container/30';
                else if (isInvalidRow) rowBgClass = 'bg-error-container/10 hover:bg-error-container/20';
                else if (isUnmatchedRow) rowBgClass = 'bg-surface-container-high/30 hover:bg-surface-container/60';

                return (
                  <tr
                    key={ev.id}
                    onClick={() => handleRowAction(ev)}
                    className={`h-14 transition-colors cursor-pointer group ${rowBgClass}`}
                  >
                    {/* Game */}
                    <td className="px-4">
                      <span className="px-1.5 py-0.5 rounded font-mono text-[11px] bg-surface-container-highest text-on-surface font-semibold">
                        {ev.game}
                      </span>
                    </td>

                    {/* Match & Tournament */}
                    <td className="px-4">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="text-on-surface font-semibold group-hover:text-primary transition-colors">
                            {ev.matchName}
                          </span>
                          {ev.arbRisk && (
                            <span className="px-1 py-0.2 rounded bg-secondary-container font-mono text-[10px] text-on-surface">
                              ARB RISK
                            </span>
                          )}
                          {ev.isIsolated && (
                            <span className="px-1 py-0.2 rounded bg-surface-container-highest font-mono text-[10px] text-on-surface-variant">
                              ISOLATED
                            </span>
                          )}
                        </div>
                        <span className="text-[12px] text-on-surface-variant">{ev.tournament}</span>
                      </div>
                    </td>

                    {/* Start Time */}
                    <td className="px-4 font-mono text-[12px] text-on-surface-variant whitespace-nowrap">
                      {ev.startText}
                    </td>

                    {/* Bet365 Cell */}
                    <td className="px-4 text-right font-mono">
                      {ev.bet365.isInvalid ? (
                        <div className="bg-error-container/30 rounded p-1">
                          <div className="text-error font-bold flex items-center justify-end gap-1 text-[13px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-error"></span>
                            <span>null</span> <span className="text-error/40">/</span> <span>1.00</span>
                          </div>
                          <div className="text-[10px] text-error font-medium">schema failure</div>
                        </div>
                      ) : ev.bet365.home !== null ? (
                        <div>
                          <div className="text-on-surface font-semibold text-[13px]">
                            {ev.bet365.home.toFixed(2)}{' '}
                            <span className="text-on-surface-variant/40">/</span>{' '}
                            {ev.bet365.away?.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-on-surface-variant/60">{ev.bet365.lastUpdate}</div>
                        </div>
                      ) : (
                        <div className="text-on-surface-variant/40">—</div>
                      )}
                    </td>

                    {/* Betano Cell */}
                    <td className="px-4 text-right font-mono">
                      {ev.betano.isMissing ? (
                        <div>
                          <div className="text-on-surface-variant/50 font-bold">—</div>
                          <div className="text-[10px] text-on-surface-variant/60">Not listed</div>
                        </div>
                      ) : ev.betano.isStale ? (
                        <div className="bg-surface-container-highest/60 rounded p-1">
                          <div className="text-on-surface-variant font-medium text-[13px]">
                            {ev.betano.home?.toFixed(2)}{' '}
                            <span className="text-on-surface-variant/40">/</span>{' '}
                            {ev.betano.away?.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-error font-medium">Stale · 6m</div>
                        </div>
                      ) : ev.betano.home !== null ? (
                        <div>
                          <div className="text-on-surface font-semibold text-[13px]">
                            {ev.betano.home.toFixed(2)}{' '}
                            <span className="text-on-surface-variant/40">/</span>{' '}
                            {ev.betano.away?.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-on-surface-variant/60">{ev.betano.lastUpdate}</div>
                        </div>
                      ) : (
                        <div className="text-on-surface-variant/40">—</div>
                      )}
                    </td>

                    {/* Superbet Cell */}
                    <td className="px-4 text-right font-mono">
                      {ev.superbet.isDivergent ? (
                        <div className="bg-secondary-container/40 border border-error/30 rounded p-1">
                          <div className="text-error font-bold flex items-center justify-end gap-1 text-[13px]">
                            <AlertTriangle size={12} className="text-error" />
                            {ev.superbet.home?.toFixed(2)}{' '}
                            <span className="text-error/50">/</span> {ev.superbet.away?.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-error font-medium">{ev.superbet.deltaText}</div>
                        </div>
                      ) : ev.superbet.home !== null ? (
                        <div>
                          <div className="text-on-surface font-semibold text-[13px]">
                            {ev.superbet.home.toFixed(2)}{' '}
                            <span className="text-on-surface-variant/40">/</span>{' '}
                            {ev.superbet.away?.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-on-surface-variant/60">{ev.superbet.lastUpdate}</div>
                        </div>
                      ) : (
                        <div className="text-on-surface-variant/40">—</div>
                      )}
                    </td>

                    {/* Pinnacle Cell */}
                    <td className="px-4 text-right font-mono">
                      {ev.pinnacle.home !== null ? (
                        <div>
                          <div className="text-on-surface font-semibold text-[13px]">
                            {ev.pinnacle.home.toFixed(2)}{' '}
                            <span className="text-on-surface-variant/40">/</span>{' '}
                            {ev.pinnacle.away?.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-on-surface-variant/60">{ev.pinnacle.lastUpdate}</div>
                        </div>
                      ) : (
                        <div className="text-on-surface-variant/40">—</div>
                      )}
                    </td>

                    {/* Integrity Status */}
                    <td className="px-4">
                      {ev.statusBadge.variant === 'matched' && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-container w-fit">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary-container"></span>
                          <span className="font-mono text-[11px] text-on-surface font-medium">Matched</span>
                        </div>
                      )}
                      {ev.statusBadge.variant === 'divergence' && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-secondary-container text-on-surface w-fit">
                          <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse"></span>
                          <span className="font-mono text-[11px] font-semibold text-error">Odds Divergence</span>
                        </div>
                      )}
                      {ev.statusBadge.variant === 'partial' && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-container text-on-surface w-fit">
                          <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                          <span className="font-mono text-[11px] font-medium">{ev.statusBadge.label}</span>
                        </div>
                      )}
                      {ev.statusBadge.variant === 'unmatched' && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-secondary-container text-on-surface w-fit">
                          <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                          <span className="font-mono text-[11px] font-medium">Unmatched</span>
                        </div>
                      )}
                      {ev.statusBadge.variant === 'confidence' && (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-surface-container text-on-surface w-fit">
                            <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                            <span className="font-mono text-[11px] text-on-surface">{ev.statusBadge.label}</span>
                          </div>
                          {ev.statusBadge.detail && (
                            <span className="text-[10px] text-on-surface-variant font-mono">
                              {ev.statusBadge.detail}
                            </span>
                          )}
                        </div>
                      )}
                      {ev.statusBadge.variant === 'invalid' && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-error-container text-on-error-container w-fit">
                          <AlertCircle size={12} />
                          <span className="font-mono text-[11px] font-semibold">Invalid Data</span>
                        </div>
                      )}
                      {ev.statusBadge.variant === 'stale' && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-container text-on-surface w-fit">
                          <span className="w-1.5 h-1.5 rounded-full bg-error"></span>
                          <span className="font-mono text-[11px] text-on-surface font-medium">Stale Provider</span>
                        </div>
                      )}
                    </td>

                    {/* Action */}
                    <td className="px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowAction(ev);
                        }}
                        className="text-primary hover:text-on-surface text-[12px] font-semibold flex items-center gap-0.5 ml-auto cursor-pointer"
                      >
                        {ev.actionText} <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredEvents.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-on-surface-variant text-[13px]">
                    No matching events found for current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer / Pagination */}
        <div className="h-10 bg-surface-container-lowest px-4 flex items-center justify-between font-mono text-[11px] text-on-surface-variant border-t border-outline-variant/20">
          <div>
            Showing <span className="text-on-surface font-medium">{filteredEvents.length}</span> of 68 active markets across 4 feed endpoints
          </div>
          <div className="flex items-center gap-2">
            <button className="px-2.5 py-0.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface disabled:opacity-40 cursor-pointer">
              Previous
            </button>
            <span className="text-on-surface font-bold px-1">1</span>
            <button className="px-2.5 py-0.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface cursor-pointer">
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
