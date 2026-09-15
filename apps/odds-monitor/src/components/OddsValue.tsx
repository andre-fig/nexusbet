import React, { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { odd } from "./DataState";

type Kind =
  "best_price" | "outlier_up" | "outlier_down" | "value_bet" | "arbitrage";
const appearance: Record<
  Kind,
  { label: string; color: string; border: string }
> = {
  best_price: {
    label: "Best price",
    color: "text-analytics-best",
    border: "border-analytics-best",
  },
  outlier_up: {
    label: "Outlier up",
    color: "text-analytics-outlier-up",
    border: "border-analytics-outlier-up",
  },
  outlier_down: {
    label: "Outlier down",
    color: "text-analytics-outlier",
    border: "border-analytics-outlier",
  },
  value_bet: {
    label: "Value bet",
    color: "text-analytics-value",
    border: "border-analytics-value",
  },
  arbitrage: {
    label: "Arbitrage",
    color: "text-analytics-arbitrage",
    border: "border-analytics-arbitrage",
  },
};

export function OddsValue({
  value,
  bestPrice,
  outlier,
  outlierDirection,
  valueBet,
  arbitrage,
}: {
  value: string | null | undefined;
  bestPrice?: string;
  outlier?: string;
  outlierDirection?: "up" | "down";
  valueBet?: string;
  arbitrage?: string;
}) {
  const number = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    above: boolean;
  } | null>(null);
  const kind: Kind | null = arbitrage
    ? "arbitrage"
    : valueBet
      ? "value_bet"
      : outlier
        ? outlierDirection === "down"
          ? "outlier_down"
          : "outlier_up"
        : bestPrice
          ? "best_price"
          : null;
  const tooltip = arbitrage ?? valueBet ?? outlier ?? bestPrice;
  if (!value || !kind || !tooltip) return <span>{odd(value)}</span>;
  const visual = appearance[kind];
  const show = () => {
    const rect = number.current?.getBoundingClientRect();
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
        ref={number}
        type="button"
        aria-label={`Odds ${value}, ${visual.label}`}
        aria-describedby={position ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setPosition(null)}
        onFocus={show}
        onBlur={() => setPosition(null)}
        className={`font-mono font-semibold cursor-help focus:outline focus:outline-2 focus:outline-offset-2 rounded-sm ${visual.color}`}
      >
        {value}
      </button>
      {position &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className={`fixed z-[100] max-w-[22rem] rounded border bg-surface-container-highest px-3 py-2 text-[12px] font-normal leading-relaxed text-on-surface shadow-xl pointer-events-none ${visual.border}`}
            style={{
              top: position.top,
              left: position.left,
              transform: position.above ? "translateY(-100%)" : undefined,
            }}
          >
            <strong className={`block mb-1 ${visual.color}`}>
              {visual.label}
            </strong>
            {tooltip}
          </div>,
          document.body,
        )}
    </>
  );
}
