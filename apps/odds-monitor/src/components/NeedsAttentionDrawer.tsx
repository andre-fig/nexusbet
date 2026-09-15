import React from "react";
import { X, AlertTriangle } from "lucide-react";
import type { Issue } from "../lib/api/types";
import type { Resource } from "../lib/api/use-resource";
import { DataState, timestamp, control } from "./DataState";
export function NeedsAttentionDrawer({
  isOpen,
  onClose,
  issues,
  onInspectIssue,
}: {
  isOpen: boolean;
  onClose: () => void;
  issues: Resource<{ items: Issue[] }>;
  onInspectIssue: (id: string) => void;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-xs cursor-pointer"
      />
      <div
        role="dialog"
        aria-label="Needs Attention"
        aria-modal="true"
        className="relative w-full max-w-md bg-surface-container-low shadow-2xl flex flex-col h-full border-l border-outline-variant/30 z-10"
      >
        <div className="h-14 px-4 bg-surface-container-lowest flex items-center justify-between border-b border-outline-variant/20">
          <h2 className="text-[16px] font-bold">Needs Attention</h2>
          <button aria-label="Close issues" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <DataState
            loading={issues.loading}
            error={issues.error}
            empty={issues.data?.items.length === 0}
          />
          {issues.data?.items.map((i) => (
            <div
              key={i.id}
              className="p-4 rounded-lg bg-surface-container border border-outline-variant/30 space-y-2"
            >
              <div className="text-[11px] text-error flex gap-2 items-center">
                <AlertTriangle size={13} />
                {i.severity} ·{" "}
                {i.type === "MARKET_INCOMPLETE"
                  ? "Incomplete market"
                  : i.type === "STALE"
                    ? "Stale market"
                    : i.type}
              </div>
              <h3 className="font-semibold text-[14px]">{i.title}</h3>
              <p className="text-[12px] text-on-surface-variant">{i.message}</p>
              <p className="font-mono text-[10px]">
                {i.provider} · {timestamp(i.detectedAt)}
              </p>
              {i.eventId && (
                <button
                  className={control}
                  onClick={() => onInspectIssue(i.eventId!)}
                >
                  Inspect event
                </button>
              )}
            </div>
          ))}
          {issues.data && issues.data.items.length === 500 && (
            <p className="text-[12px]">
              Showing at most 500 issues. Use the issues API filters for more
              specific results.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
