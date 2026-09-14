import React, { useState } from 'react';
import { 
  ArrowLeft, 
  RefreshCw, 
  Code2, 
  Gamepad2, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Copy, 
  Check, 
  Sparkles, 
  ChevronDown, 
  ChevronUp,
  Radio
} from 'lucide-react';
import { INGESTED_FEEDS_DATA, PRIORITY_MARKETS_DATA, RAW_JSON_PAYLOAD } from '../data/mockData';

interface EventDetailViewProps {
  onBackToDashboard: () => void;
  onSyncEvent: () => void;
  isSyncing: boolean;
}

export const EventDetailView: React.FC<EventDetailViewProps> = ({
  onBackToDashboard,
  onSyncEvent,
  isSyncing,
}) => {
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [selectedProviderFilter, setSelectedProviderFilter] = useState('All Providers (4)');
  const [selectedMarketFilter, setSelectedMarketFilter] = useState('Match Winner (Full Match)');
  const [selectedRunnerFilter, setSelectedRunnerFilter] = useState('FURIA (1.70)');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(RAW_JSON_PAYLOAD, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const timePoints = [
    { label: '-6h (12:00)', b365: 1.68, btno: 1.66, spbt: 1.65, pinn: 1.67 },
    { label: '-5h (13:00)', b365: 1.69, btno: 1.67, spbt: 1.64, pinn: 1.68 },
    { label: '-4h (14:00)', b365: 1.67, btno: 1.68, spbt: 1.66, pinn: 1.67 },
    { label: '-3h (15:00)', b365: 1.70, btno: 1.67, spbt: 1.67, pinn: 1.69 },
    { label: '-2h (16:00)', b365: 1.71, btno: 1.69, spbt: 1.68, pinn: 1.70 },
    { label: '-1h (17:00)', b365: 1.72, btno: 1.70, spbt: 1.68, pinn: 1.71 },
    { label: 'NOW (18:00 UTC)', b365: 1.72, btno: 1.70, spbt: 1.68, pinn: 1.71 },
  ];

  return (
    <div className="flex flex-col w-full px-4 md:px-6 py-4 space-y-5 max-w-7xl mx-auto">
      {/* Top Breadcrumb & Quick Action Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onBackToDashboard}
            className="flex items-center gap-1.5 text-on-surface-variant hover:text-on-surface text-[11px] font-semibold tracking-wider uppercase transition-colors cursor-pointer"
          >
            <ArrowLeft size={14} />
            <span>Back to Dashboard</span>
          </button>
          <span className="text-on-surface-variant/40 font-mono text-[11px]">/</span>
          <span className="font-mono text-[11px] text-on-surface-variant/70 tracking-wide">
            iem-cologne-2025-m39
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onSyncEvent}
            disabled={isSyncing}
            className="h-[30px] px-3.5 flex items-center gap-1.5 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface transition-colors shadow-xs cursor-pointer border border-outline-variant/30 disabled:opacity-50"
            type="button"
          >
            <RefreshCw size={14} className={`text-primary ${isSyncing ? 'animate-spin' : ''}`} />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Sync Event</span>
          </button>
          <button
            onClick={() => setIsAccordionOpen(!isAccordionOpen)}
            className="h-[30px] px-3.5 flex items-center gap-1.5 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface transition-colors shadow-xs cursor-pointer border border-outline-variant/30"
            type="button"
          >
            <Code2 size={14} className="text-tertiary" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Raw JSON</span>
          </button>
        </div>
      </div>

      {/* Event Summary Masthead */}
      <div className="p-4 md:p-5 rounded-lg bg-surface-container-low shadow-sm border border-outline-variant/20">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-[22px] font-bold text-on-surface tracking-tight">FURIA vs NAVI</h1>
              <span className="px-2 py-0.5 rounded bg-surface-container text-primary font-mono text-[11px] font-semibold tracking-wide">
                BO3
              </span>
              <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-surface-container-high border border-outline-variant/30">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-container animate-pulse"></span>
                <span className="text-[11px] font-semibold text-on-surface uppercase tracking-wider">
                  Matched · 98% confidence
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 text-on-surface-variant text-[12px] flex-wrap">
              <span className="flex items-center gap-1.5">
                <Gamepad2 size={14} className="text-primary" />
                <span>CS2</span>
                <span className="text-on-surface-variant/40">•</span>
                <span>IEM Cologne 2025 · Group B Upper Final</span>
              </span>
              <span className="text-on-surface-variant/40">•</span>
              <span className="flex items-center gap-1 font-mono text-[12px]">
                <Clock size={14} />
                <span>Today · 18:00 UTC (in 2h 14m)</span>
              </span>
              <span className="text-on-surface-variant/40">•</span>
              <span className="font-mono text-[11px] text-on-surface-variant/70">
                Engine: reconciliation-v4.1
              </span>
            </div>
          </div>

          {/* Metric Badges */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="p-2.5 px-3.5 rounded bg-surface-container text-right border border-outline-variant/20">
              <div className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider">
                Max Arbitrage
              </div>
              <div className="font-mono text-[17px] text-primary font-bold tabular-nums">
                +1.42%
              </div>
            </div>
            <div className="p-2.5 px-3.5 rounded bg-surface-container text-right border border-outline-variant/20">
              <div className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider">
                Provider Quorum
              </div>
              <div className="font-mono text-[17px] text-on-surface font-bold tabular-nums">
                4 / 4 OK
              </div>
            </div>
            <div className="p-2.5 px-3.5 rounded bg-surface-container text-right border border-outline-variant/20">
              <div className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider">
                Feed Latency
              </div>
              <div className="font-mono text-[17px] text-on-surface font-bold tabular-nums">
                14ms
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Source Ingestion & Normalization Table */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={16} className="text-primary" />
            <h2 className="text-[16px] font-semibold text-on-surface tracking-tight">
              Source Ingestion &amp; Normalization
            </h2>
          </div>
          <span className="font-mono text-[11px] text-on-surface-variant">4 bookmaker feeds synced</span>
        </div>

        <div className="overflow-x-auto rounded-lg bg-surface-container-low shadow-sm border border-outline-variant/20">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest text-on-surface-variant text-[11px] font-semibold uppercase tracking-wider border-b border-outline-variant/20">
                <th className="py-2.5 px-4">Provider</th>
                <th className="py-2.5 px-4">Raw Teams (Source Strings)</th>
                <th className="py-2.5 px-4">Tournament Raw</th>
                <th className="py-2.5 px-4">Start Time</th>
                <th className="py-2.5 px-4">Ingestion Status</th>
                <th className="py-2.5 px-4 text-right">Last Update</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-highest/20 text-[12px]">
              {INGESTED_FEEDS_DATA.map((feed) => (
                <tr key={feed.code} className="hover:bg-surface-container transition-colors">
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${feed.dotColorClass}`}></div>
                      <span className="font-semibold text-on-surface">{feed.provider}</span>
                      <span className="font-mono text-[10px] text-on-surface-variant px-1 rounded bg-surface-container-high">
                        {feed.code}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-[11px] text-on-surface">
                    <span>{feed.rawTeams.home}</span>
                    {feed.rawTeams.normalizedHome && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-surface-container-high text-tertiary text-[10px] font-mono inline-flex items-center gap-1">
                        <Sparkles size={10} />
                        <span>→ {feed.rawTeams.normalizedHome}</span>
                      </span>
                    )}
                    <span className="text-on-surface-variant/40 mx-1">/</span>
                    <span>{feed.rawTeams.away}</span>
                    {feed.rawTeams.normalizedAway && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-surface-container-high text-tertiary text-[10px] font-mono inline-flex items-center gap-1">
                        <Sparkles size={10} />
                        <span>→ {feed.rawTeams.normalizedAway}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-on-surface-variant font-mono text-[11px]">
                    {feed.tournamentRaw}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-[11px] tabular-nums text-on-surface">
                    {feed.startTime}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container text-on-surface text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                      <span>{feed.status}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-[11px] text-on-surface-variant tabular-nums">
                    {feed.lastUpdate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 3: Priority Markets Side-by-Side Comparison Matrix */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[16px] font-semibold text-on-surface tracking-tight">
              Priority Markets Matrix
            </h2>
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px] text-on-surface-variant">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-xs bg-primary"></span> Best Available
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-xs bg-error"></span> Divergence / Missing
            </span>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg bg-surface-container-low shadow-sm border border-outline-variant/20">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest text-on-surface-variant text-[11px] font-semibold uppercase tracking-wider border-b border-outline-variant/20">
                <th className="py-2.5 px-4 w-1/4">Market / Selection</th>
                <th className="py-2.5 px-4 text-right">Bet365</th>
                <th className="py-2.5 px-4 text-right">Betano</th>
                <th className="py-2.5 px-4 text-right">Superbet</th>
                <th className="py-2.5 px-4 text-right">Pinnacle</th>
                <th className="py-2.5 px-4 text-right">Consensus / Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-highest/20 text-[12px]">
              {PRIORITY_MARKETS_DATA.map((group, groupIdx) => (
                <React.Fragment key={groupIdx}>
                  {/* Category Header Row */}
                  <tr className="bg-surface-container/60">
                    <td
                      colSpan={6}
                      className="py-1.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-tertiary"
                    >
                      {group.name}
                    </td>
                  </tr>

                  {/* Selection Rows */}
                  {group.rows.map((row, rowIdx) => (
                    <tr key={rowIdx} className="hover:bg-surface-container transition-colors">
                      <td className="py-2.5 px-4 font-semibold text-on-surface flex items-center gap-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            row.selectionName === 'FURIA' ? 'bg-primary' : 'bg-on-surface-variant'
                          }`}
                        ></span>
                        <span>{row.selectionName}</span>
                      </td>

                      {/* Bet365 */}
                      <td className="py-2.5 px-4 text-right font-mono text-[13px] tabular-nums">
                        <span
                          className={
                            row.bestProvider === 'bet365' ? 'text-primary font-bold' : 'text-on-surface'
                          }
                        >
                          {typeof row.bet365 === 'number' ? row.bet365.toFixed(2) : row.bet365}
                        </span>
                      </td>

                      {/* Betano */}
                      <td className="py-2.5 px-4 text-right font-mono text-[13px] tabular-nums">
                        {row.isBetanoUnavailable ? (
                          <span className="px-2 py-0.5 rounded bg-error-container text-error text-[11px] font-mono inline-flex items-center gap-1 font-semibold">
                            <AlertTriangle size={11} />
                            <span>Unavailable</span>
                          </span>
                        ) : row.betano === '—' ? (
                          <span className="text-on-surface-variant/40">—</span>
                        ) : (
                          <span
                            className={
                              row.bestProvider === 'betano' ? 'text-primary font-bold' : 'text-on-surface'
                            }
                          >
                            {typeof row.betano === 'number' ? row.betano.toFixed(2) : row.betano}
                          </span>
                        )}
                      </td>

                      {/* Superbet */}
                      <td className="py-2.5 px-4 text-right font-mono text-[13px] tabular-nums">
                        <span
                          className={
                            row.bestProvider === 'superbet' ? 'text-primary font-bold' : 'text-on-surface'
                          }
                        >
                          {typeof row.superbet === 'number' ? row.superbet.toFixed(2) : row.superbet}
                        </span>
                      </td>

                      {/* Pinnacle */}
                      <td className="py-2.5 px-4 text-right font-mono text-[13px] tabular-nums">
                        <span
                          className={
                            row.bestProvider === 'pinnacle' ? 'text-primary font-bold' : 'text-on-surface'
                          }
                        >
                          {typeof row.pinnacle === 'number' ? row.pinnacle.toFixed(2) : row.pinnacle}
                        </span>
                      </td>

                      {/* Consensus / Delta */}
                      <td className="py-2.5 px-4 text-right font-mono text-[13px] tabular-nums text-on-surface-variant">
                        {row.isFeedIncomplete ? (
                          <span className="px-2 py-0.5 rounded bg-surface-container-high text-error text-[11px] font-semibold uppercase">
                            Feed Incomplete
                          </span>
                        ) : (
                          <>
                            <span className="text-on-surface font-medium">{row.consensus}</span>
                            <span className="text-tertiary text-[11px] ml-1 font-normal">
                              ({row.delta})
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 4: Quantitative Odds History Chart */}
      <div className="p-4 md:p-5 rounded-lg bg-surface-container-low shadow-sm border border-outline-variant/20 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
          <div>
            <h2 className="text-[16px] font-semibold text-on-surface tracking-tight">Odds History</h2>
            <p className="text-[12px] text-on-surface-variant">
              Quantitative price divergence and liquidity shifts over last 6 hours
            </p>
          </div>

          {/* Filter Dropdowns */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <select
                value={selectedProviderFilter}
                onChange={(e) => setSelectedProviderFilter(e.target.value)}
                className="h-[30px] pl-2.5 pr-7 rounded bg-surface-container text-on-surface text-[12px] appearance-none cursor-pointer border border-outline-variant/30 focus:outline-none focus:bg-surface-bright"
              >
                <option>All Providers (4)</option>
                <option>Bet365 only</option>
                <option>Betano only</option>
                <option>Superbet only</option>
                <option>Pinnacle only</option>
              </select>
              <ChevronDown size={14} className="absolute right-2 top-2 text-on-surface-variant pointer-events-none" />
            </div>

            <div className="relative">
              <select
                value={selectedMarketFilter}
                onChange={(e) => setSelectedMarketFilter(e.target.value)}
                className="h-[30px] pl-2.5 pr-7 rounded bg-surface-container text-on-surface text-[12px] appearance-none cursor-pointer border border-outline-variant/30 focus:outline-none focus:bg-surface-bright"
              >
                <option>Match Winner (Full Match)</option>
                <option>Map 1 Winner</option>
                <option>Map 2 Winner</option>
                <option>Map 3 Winner</option>
              </select>
              <ChevronDown size={14} className="absolute right-2 top-2 text-on-surface-variant pointer-events-none" />
            </div>

            <div className="relative">
              <select
                value={selectedRunnerFilter}
                onChange={(e) => setSelectedRunnerFilter(e.target.value)}
                className="h-[30px] pl-2.5 pr-7 rounded bg-surface-container text-on-surface text-[12px] appearance-none cursor-pointer border border-outline-variant/30 focus:outline-none focus:bg-surface-bright"
              >
                <option>FURIA (1.70)</option>
                <option>NAVI (2.10)</option>
              </select>
              <ChevronDown size={14} className="absolute right-2 top-2 text-on-surface-variant pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Chart Legend */}
        <div className="flex items-center gap-4 text-on-surface-variant font-mono text-[11px] flex-wrap border-b border-surface-container-highest/20 pb-2.5">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-primary-container"></span>
            <span className="text-on-surface font-medium">Bet365</span>
            <span className="tabular-nums text-on-surface-variant">1.72</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-tertiary-container"></span>
            <span className="text-on-surface font-medium">Betano</span>
            <span className="tabular-nums text-on-surface-variant">1.70</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-primary-fixed"></span>
            <span className="text-on-surface font-medium">Superbet</span>
            <span className="tabular-nums text-on-surface-variant">1.68</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-secondary-fixed"></span>
            <span className="text-on-surface font-medium">Pinnacle</span>
            <span className="tabular-nums text-on-surface-variant">1.71</span>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="w-2 h-2 rounded-full bg-primary-container animate-ping"></span>
            <span className="text-tertiary font-mono text-[11px]">STREAM LIVE</span>
          </div>
        </div>

        {/* Minimalist Vector Timeline */}
        <div className="relative w-full h-56 bg-surface-container-lowest rounded p-3 flex flex-col justify-between overflow-hidden border border-outline-variant/20">
          {/* Background Grid Horizontal Lines */}
          <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-3 opacity-20">
            <div className="w-full border-b border-outline-variant"></div>
            <div className="w-full border-b border-outline-variant"></div>
            <div className="w-full border-b border-outline-variant"></div>
            <div className="w-full border-b border-outline-variant"></div>
          </div>

          {/* Interactive SVG Paths */}
          <svg
            className="w-full h-full absolute inset-0 preserve-3d"
            fill="none"
            preserveAspectRatio="none"
            viewBox="0 0 900 200"
          >
            {/* Bet365: #5b8cff */}
            <polyline
              points="0,120 150,115 300,130 450,110 600,105 750,95 900,90"
              stroke="#5b8cff"
              strokeLinejoin="round"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            {/* Betano: #5492e7 dashed */}
            <polyline
              points="0,130 150,125 300,120 450,125 600,115 750,110 900,105"
              stroke="#5492e7"
              strokeDasharray="4 2"
              strokeLinejoin="round"
              strokeWidth="1.75"
              vectorEffect="non-scaling-stroke"
            />
            {/* Superbet: #dae2ff */}
            <polyline
              points="0,140 150,145 300,135 450,130 600,125 750,125 900,120"
              stroke="#dae2ff"
              strokeLinejoin="round"
              strokeWidth="1.75"
              vectorEffect="non-scaling-stroke"
            />
            {/* Pinnacle: #dee2ef */}
            <polyline
              points="0,115 150,118 300,122 450,112 600,108 750,100 900,98"
              stroke="#dee2ef"
              strokeLinejoin="round"
              strokeWidth="1.75"
              vectorEffect="non-scaling-stroke"
            />

            {/* Live cursor crosshair overlay */}
            <line
              opacity="0.4"
              stroke="#8d909f"
              strokeDasharray="2 2"
              strokeWidth="1"
              x1="750"
              x2="750"
              y1="0"
              y2="200"
            />
            <circle cx="750" cy="95" fill="#5b8cff" r="4" />
            <circle cx="750" cy="110" fill="#5492e7" r="3.5" />
            <circle cx="750" cy="125" fill="#dae2ff" r="3.5" />
            <circle cx="750" cy="100" fill="#dee2ef" r="3.5" />
          </svg>

          {/* Y-Axis Ticks (Right-pinned) */}
          <div className="relative z-10 w-full flex justify-between items-start pointer-events-none font-mono text-[10px] text-on-surface-variant/70">
            <span>1.85 (Upper Band)</span>
            <span className="tabular-nums">1.85</span>
          </div>
          <div className="relative z-10 w-full flex justify-between items-center pointer-events-none font-mono text-[10px] text-on-surface-variant/70">
            <span>1.75 (Consensus Pivot)</span>
            <span className="tabular-nums">1.75</span>
          </div>
          <div className="relative z-10 w-full flex justify-between items-end pointer-events-none font-mono text-[10px] text-on-surface-variant/70">
            <span>1.65 (Baseline Support)</span>
            <span className="tabular-nums">1.65</span>
          </div>
        </div>

        {/* X-Axis Timeline Markers */}
        <div className="flex justify-between items-center font-mono text-[11px] text-on-surface-variant px-1 overflow-x-auto">
          <span>-6h (12:00)</span>
          <span>-5h (13:00)</span>
          <span>-4h (14:00)</span>
          <span>-3h (15:00)</span>
          <span>-2h (16:00)</span>
          <span>-1h (17:00)</span>
          <span className="text-on-surface font-semibold">NOW (18:00 UTC)</span>
        </div>
      </div>

      {/* Section 5: Collapsible Raw Ingestion Payloads Accordion */}
      <div className="rounded-lg bg-surface-container-low shadow-sm overflow-hidden border border-outline-variant/20">
        <button
          onClick={() => setIsAccordionOpen(!isAccordionOpen)}
          aria-expanded={isAccordionOpen}
          className="w-full py-2.5 px-4 flex items-center justify-between bg-surface-container hover:bg-surface-container-high transition-colors text-left cursor-pointer"
          type="button"
        >
          <div className="flex items-center gap-2">
            <Code2 size={18} className="text-tertiary" />
            <span className="text-[15px] font-semibold text-on-surface">
              Raw Provider Data (Canonical &amp; Ingested Payloads)
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant uppercase font-semibold">
              Sanitized
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-on-surface-variant font-mono text-[11px]">
            <span>{isAccordionOpen ? 'Click to collapse' : 'Click to expand'}</span>
            {isAccordionOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>

        {isAccordionOpen && (
          <div className="p-4 bg-surface-container-lowest space-y-3 border-t border-outline-variant/20">
            <div className="flex items-center justify-between font-mono text-[11px] text-on-surface-variant pb-2 border-b border-surface-container-highest/20">
              <span>EVENT_SCHEMA_V3 // INGESTION_SESSION_ID: 8fa9-9941a8-cologne</span>
              <button
                onClick={handleCopyJson}
                className="flex items-center gap-1 hover:text-on-surface text-primary transition-colors cursor-pointer"
                type="button"
              >
                {copiedJson ? (
                  <>
                    <Check size={13} className="text-green-400" />
                    <span className="text-green-400 font-semibold">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>
            </div>

            <pre className="font-mono text-[12px] leading-relaxed text-on-surface overflow-x-auto p-3 rounded bg-surface-container/40 border border-outline-variant/10 max-h-96">
              <code>{JSON.stringify(RAW_JSON_PAYLOAD, null, 2)}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
