import React, { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Kind = "best_price" | "outlier" | "arbitrage";
const appearance: Record<
  Kind,
  { label: string; icon: string; className: string }
> = {
  best_price: {
    label: "BEST PRICE",
    icon: "★",
    className: "text-analytics-best bg-analytics-best-bg",
  },
  outlier: {
    label: "OUTLIER",
    icon: "!",
    className: "text-analytics-outlier bg-analytics-outlier-bg",
  },
  arbitrage: {
    label: "ARBITRAGE",
    icon: "↔",
    className: "text-status-healthy bg-analytics-arbitrage-bg",
  },
};

export function AnalyticsBadge({
  kind,
  tooltip,
  label,
}: {
  kind: Kind;
  tooltip: string;
  label?: string;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    above: boolean;
  } | null>(null);
  const visual = appearance[kind];
  const show = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const above = rect.bottom > window.innerHeight - 170;
    setPosition({
      top: above ? rect.top - 8 : rect.bottom + 8,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 360)),
      above,
    });
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={visual.label}
        aria-describedby={position ? id : undefined}
        title={tooltip}
        onMouseEnter={show}
        onMouseLeave={() => setPosition(null)}
        onFocus={show}
        onBlur={() => setPosition(null)}
        className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none cursor-help focus:outline focus:outline-2 focus:outline-offset-2 ${visual.className}`}
      >
        {label ?? visual.icon}
      </button>
      {position &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="fixed z-[100] max-w-[22rem] rounded border border-outline-variant bg-surface-container-highest px-3 py-2 text-[12px] font-normal leading-relaxed text-on-surface shadow-xl pointer-events-none"
            style={{
              top: position.top,
              left: position.left,
              transform: position.above ? "translateY(-100%)" : undefined,
            }}
          >
            <strong className="block mb-1">{visual.label}</strong>
            {tooltip}
          </div>,
          document.body,
        )}
    </>
  );
}
