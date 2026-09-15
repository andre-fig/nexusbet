import React from "react";
export function DataState({
  loading,
  error,
  empty = false,
}: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
}) {
  if (error)
    return (
      <div
        role="alert"
        className="p-4 rounded border border-error/30 text-error text-sm"
      >
        {error}. Use Sync to retry. Previously loaded data may be outdated.
      </div>
    );
  if (loading)
    return (
      <div
        role="status"
        className="p-4 animate-pulse bg-surface-container rounded text-on-surface-variant text-sm"
      >
        Loading data…
      </div>
    );
  if (empty)
    return (
      <div className="p-8 text-center text-on-surface-variant">
        No data for the selected filters.
      </div>
    );
  return null;
}
export const timestamp = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "Not observed";
export const odd = (displayOdds: string | null | undefined) =>
  displayOdds ?? "—";
export const panel =
  "bg-surface-container-low rounded-lg shadow-sm border border-outline-variant/20";
export const control =
  "h-8 px-3 bg-surface-container text-on-surface text-[12px] rounded border border-outline-variant/30 disabled:opacity-40";
