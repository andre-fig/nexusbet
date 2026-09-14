import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full border-t border-outline-variant/20 bg-surface-container-lowest/80 py-3 mt-auto">
      <div className="w-full px-4 md:px-6 flex flex-wrap items-center justify-between font-mono text-[11px] text-on-surface-variant/70 gap-2">
        <div className="flex items-center">
          <span>ENGINE: REALTIME STREAM</span>
          <span className="mx-2">•</span>
          <span>LATENCY: 14ms</span>
        </div>
        <div>
          <span>ODDS INTEGRITY SUITE © 2025</span>
        </div>
      </div>
    </footer>
  );
};
