import React, { useState } from 'react';
import { X, AlertTriangle, AlertCircle, Clock, Link2, CheckCheck, Sparkles, Check } from 'lucide-react';
import { IssueItem } from '../types';

interface NeedsAttentionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  issues: IssueItem[];
  onInspectIssue: (issue: IssueItem) => void;
  onBatchAcknowledge: () => void;
  onResolveSingleIssue: (issueId: string) => void;
}

export const NeedsAttentionDrawer: React.FC<NeedsAttentionDrawerProps> = ({
  isOpen,
  onClose,
  issues,
  onInspectIssue,
  onBatchAcknowledge,
  onResolveSingleIssue,
}) => {
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const handleAction = (issue: IssueItem) => {
    if (issue.actionText === 'Inspect Market' || issue.eventId === 'iem-cologne-2025-m40') {
      onInspectIssue(issue);
    } else {
      setAcknowledgedIds((prev) => new Set([...prev, issue.id]));
      setTimeout(() => {
        onResolveSingleIssue(issue.id);
      }, 400);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
      {/* Backdrop */}
      <div 
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity cursor-pointer animate-fade-in"
      />

      {/* Slide-over Drawer */}
      <div className="relative w-full max-w-md bg-surface-container-low shadow-2xl flex flex-col h-full border-l border-outline-variant/30 z-10 transform transition-transform duration-200">
        {/* Drawer Header */}
        <div className="h-14 px-4 bg-surface-container-lowest flex items-center justify-between border-b border-outline-variant/20">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-error animate-pulse"></span>
            <h2 className="text-[16px] font-bold text-on-surface">Needs Attention</h2>
            <span className="px-2 py-0.5 rounded-full bg-error-container font-mono text-[11px] text-on-error-container font-semibold">
              {issues.length} issues
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {/* Drawer Content / Issues List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {issues.length === 0 ? (
            <div className="text-center py-12 text-on-surface-variant">
              <CheckCheck size={36} className="mx-auto text-primary mb-2 opacity-80" />
              <p className="font-semibold text-[15px] text-on-surface">All caught up!</p>
              <p className="text-[12px] mt-1">No outstanding data anomalies or sync issues.</p>
            </div>
          ) : (
            issues.map((issue) => {
              const isResolved = acknowledgedIds.has(issue.id);

              let badgeColor = 'bg-secondary-container text-error';
              if (issue.type === 'INVALID DATA') badgeColor = 'bg-error-container text-on-error-container';
              else if (issue.type === 'STALE PROVIDER') badgeColor = 'bg-surface-container-highest text-on-surface';
              else if (issue.type === 'UNMATCHED') badgeColor = 'bg-surface-container-highest text-on-surface';
              else if (issue.type === 'PARTIAL MATCH') badgeColor = 'bg-surface-container-highest text-on-surface';

              return (
                <div
                  key={issue.id}
                  className={`p-3.5 rounded-lg bg-surface-container hover:bg-surface-container-high transition-all flex flex-col gap-1.5 border border-outline-variant/20 ${
                    isResolved ? 'opacity-40 scale-98 pointer-events-none' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`px-1.5 py-0.5 rounded font-mono text-[10px] uppercase font-semibold ${badgeColor}`}>
                      {issue.type}
                    </span>
                    <span className="font-mono text-[10px] text-on-surface-variant">
                      {issue.gameInfo}
                    </span>
                  </div>

                  <div className="text-[14px] text-on-surface font-semibold">
                    {issue.title}
                  </div>

                  <p className="text-[12px] text-on-surface-variant leading-relaxed">
                    {issue.description}
                  </p>

                  <div className="flex items-center justify-between pt-1 mt-1 border-t border-surface-container-highest/20">
                    <span className="font-mono text-[11px] text-on-surface-variant/70">
                      {issue.timeAgo}
                    </span>
                    <button
                      onClick={() => handleAction(issue)}
                      className={`px-3 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                        issue.type === 'ODDS DIVERGENCE'
                          ? 'bg-primary text-on-primary hover:bg-tertiary'
                          : 'bg-surface-container-highest text-on-surface hover:bg-surface-bright'
                      }`}
                      type="button"
                    >
                      {isResolved ? (
                        <>
                          <Check size={12} />
                          <span>Done</span>
                        </>
                      ) : (
                        issue.actionText
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Drawer Footer Actions */}
        <div className="p-4 bg-surface-container-lowest flex items-center justify-between border-t border-outline-variant/20">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-surface-container hover:bg-surface-container-high text-[13px] text-on-surface transition-colors cursor-pointer"
            type="button"
          >
            Dismiss
          </button>
          <button
            onClick={onBatchAcknowledge}
            disabled={issues.length === 0}
            className="px-4 py-1.5 rounded bg-primary hover:bg-tertiary text-[13px] text-on-primary font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            type="button"
          >
            <CheckCheck size={16} />
            <span>Batch Acknowledge</span>
          </button>
        </div>
      </div>
    </div>
  );
};
