import React, { useState } from 'react';
import { X, AlertTriangle, Flag, PauseCircle, Check, ShieldAlert, TrendingUp } from 'lucide-react';
import { OperationalOddsEvent } from '../types';

interface EventInspectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  event?: OperationalOddsEvent | null;
  onBlacklistProvider?: (providerName: string) => void;
}

export const EventInspectionModal: React.FC<EventInspectionModalProps> = ({
  isOpen,
  onClose,
  event,
  onBlacklistProvider,
}) => {
  const [isBlacklisted, setIsBlacklisted] = useState(false);

  if (!isOpen) return null;

  const matchTitle = event?.matchName || 'Vitality vs FaZe Clan';
  const gameTag = event?.game || 'CS2';
  const tournamentName = event?.tournament || 'IEM Cologne 2025 · Quarterfinals';

  const handleBlacklist = () => {
    setIsBlacklisted(true);
    if (onBlacklistProvider) {
      onBlacklistProvider('Superbet');
    }
    setTimeout(() => {
      onClose();
      setIsBlacklisted(false);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div 
        onClick={onClose} 
        className="absolute inset-0 cursor-pointer"
      />

      <div className="relative w-full max-w-2xl bg-surface-container-low rounded-xl shadow-2xl overflow-hidden flex flex-col border border-outline-variant/30 z-10 animate-scale-in">
        {/* Modal Header */}
        <div className="px-5 py-4 bg-surface-container flex items-center justify-between border-b border-outline-variant/20">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded font-mono text-[11px] bg-surface-container-highest text-on-surface font-semibold">
                {gameTag}
              </span>
              <span className="text-[12px] text-on-surface-variant">{tournamentName}</span>
            </div>
            <h3 className="text-[18px] font-bold text-on-surface mt-0.5">{matchTitle}</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
          {/* Live Diagnostic Alert banner */}
          <div className="p-3.5 rounded-lg bg-error-container/20 border border-error/30 flex items-start gap-3">
            <AlertTriangle className="text-error shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <div className="text-[13px] text-on-surface font-bold">Severe Divergence Flagged</div>
              <div className="text-[12px] text-on-surface-variant mt-0.5 leading-relaxed">
                Superbet is currently trading at{' '}
                <span className="text-error font-mono font-bold">2.40</span> (+40.3% over consensus fair price 1.71).
                Arbitrage exploitable against Pinnacle (1.70 / 2.15).
              </div>
            </div>
          </div>

          {/* Comparative Multi-Feed Matrix */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Provider Cross-Audit Matrix
              </span>
              <span className="font-mono text-[11px] text-on-surface-variant">
                Consensus: 1.71 / 2.11 (Overround 105.4%)
              </span>
            </div>

            <div className="bg-surface-container rounded-lg overflow-hidden border border-outline-variant/20">
              <div className="grid grid-cols-5 p-2.5 text-[10px] font-semibold text-on-surface-variant/80 uppercase tracking-wider bg-surface-container-lowest border-b border-outline-variant/20">
                <span>Bookmaker</span>
                <span className="text-right">Vitality (1)</span>
                <span className="text-right">FaZe (2)</span>
                <span className="text-right">Margin</span>
                <span className="text-right">Latency</span>
              </div>

              {/* Bet365 */}
              <div className="grid grid-cols-5 p-2.5 font-mono text-[12px] items-center hover:bg-surface-container-high/40 border-b border-surface-container-highest/20">
                <span className="font-semibold text-on-surface">BET365</span>
                <span className="text-right text-on-surface">1.72</span>
                <span className="text-right text-on-surface">2.10</span>
                <span className="text-right text-on-surface-variant">5.7%</span>
                <span className="text-right text-on-surface-variant">18s</span>
              </div>

              {/* Betano */}
              <div className="grid grid-cols-5 p-2.5 font-mono text-[12px] items-center hover:bg-surface-container-high/40 border-b border-surface-container-highest/20">
                <span className="font-semibold text-on-surface">BETANO</span>
                <span className="text-right text-on-surface">1.71</span>
                <span className="text-right text-on-surface">2.12</span>
                <span className="text-right text-on-surface-variant">5.6%</span>
                <span className="text-right text-on-surface-variant">22s</span>
              </div>

              {/* Superbet (Highlight Anomaly) */}
              <div className="grid grid-cols-5 p-2.5 font-mono text-[12px] items-center bg-secondary-container/40 border-b border-error/30">
                <span className="font-semibold text-error flex items-center gap-1">
                  SUPERBET <Flag size={12} />
                </span>
                <span className="text-right text-error font-bold text-[13px]">2.40</span>
                <span className="text-right text-error font-bold text-[13px]">1.55</span>
                <span className="text-right text-error">6.1%</span>
                <span className="text-right text-on-surface-variant">14s</span>
              </div>

              {/* Pinnacle */}
              <div className="grid grid-cols-5 p-2.5 font-mono text-[12px] items-center hover:bg-surface-container-high/40">
                <span className="font-semibold text-on-surface">PINNACLE</span>
                <span className="text-right text-on-surface font-semibold">1.70</span>
                <span className="text-right text-on-surface font-semibold">2.15</span>
                <span className="text-right text-on-surface-variant">2.8%</span>
                <span className="text-right text-on-surface-variant">12s</span>
              </div>
            </div>
          </div>

          {/* Inline Visual Delta Sparkline Graph */}
          <div className="p-3.5 rounded-lg bg-surface-container space-y-2 border border-outline-variant/20">
            <div className="flex items-center justify-between text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
              <span>Historical Drift (Last 30 mins)</span>
              <span className="text-primary font-mono flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                Live Polling
              </span>
            </div>

            <svg className="w-full h-16" fill="none" preserveAspectRatio="none" viewBox="0 0 400 60">
              {/* Normal Consensus Band */}
              <path
                className="text-on-surface-variant/40"
                d="M0,35 Q100,34 200,36 T400,35"
                stroke="currentColor"
                strokeDasharray="2 2"
                strokeWidth="1.5"
              />
              {/* Superbet Drift Line Outlier */}
              <path
                className="text-error"
                d="M0,36 Q80,35 160,38 T260,18 L340,12 L400,10"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              {/* Consensus Line */}
              <path
                className="text-primary-container"
                d="M0,35 Q70,36 150,34 T300,37 L400,36"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>

            <div className="flex items-center justify-between font-mono text-[10px] text-on-surface-variant pt-1 border-t border-surface-container-highest/20">
              <span>T-30m: 1.72</span>
              <span>T-15m: 1.71</span>
              <span>T-5m: Drift detected</span>
              <span className="text-error font-bold">Now: 2.40 (Outlier)</span>
            </div>
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="px-5 py-3 bg-surface-container flex items-center justify-between border-t border-outline-variant/20">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary-container animate-pulse"></span>
            <span className="font-mono text-[11px] text-on-surface-variant font-medium">
              AUTO-QUARANTINE: ACTIVE
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded bg-surface-container-high hover:bg-surface-bright text-on-surface text-[12px] font-medium transition-colors cursor-pointer"
              type="button"
            >
              Close
            </button>
            <button
              onClick={handleBlacklist}
              disabled={isBlacklisted}
              className="px-4 py-1.5 rounded bg-error-container text-on-error-container hover:bg-error hover:text-on-primary text-[12px] font-semibold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              type="button"
            >
              {isBlacklisted ? (
                <>
                  <Check size={14} />
                  <span>Market Blacklisted!</span>
                </>
              ) : (
                <>
                  <PauseCircle size={15} />
                  <span>Blacklist Superbet Market</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
