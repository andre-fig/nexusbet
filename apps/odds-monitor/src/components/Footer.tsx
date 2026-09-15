import React from "react";
export function Footer() {
  return (
    <footer className="mt-auto px-6 py-3 border-t border-outline-variant/20 text-[10px] font-mono text-on-surface-variant flex justify-between">
      <span>Odds Monitor · internal data quality</span>
      <span>REST state · SSE invalidations · pre-match</span>
    </footer>
  );
}
