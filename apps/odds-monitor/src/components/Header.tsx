import React, { useState } from "react";
import {
  RefreshCw,
  Moon,
  Sun,
  User,
  LayoutDashboard,
  FileText,
  Layers,
  ExternalLink,
} from "lucide-react";

interface HeaderProps {
  currentView: "dashboard" | "event-detail";
  onNavigate: (view: "dashboard" | "event-detail") => void;
  liveStatus: string;
  eventTitle?: string;
  onSync: () => void;
  isSyncing: boolean;
  isDarkMode: boolean;
  onToggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  onNavigate,
  liveStatus,
  eventTitle,
  onSync,
  isSyncing,
  isDarkMode,
  onToggleTheme,
}) => {
  return (
    <header className="fixed top-0 left-0 right-0 z-40 w-full bg-surface-container-lowest/95 backdrop-blur-md border-b border-outline-variant/30">
      <div className="h-14 w-full px-4 md:px-6 flex items-center justify-between">
        {/* Left Section: Logo & Environment */}
        <div className="flex items-center gap-3 sm:gap-4">
          <div
            onClick={() => onNavigate("dashboard")}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <div className="w-7 h-7 rounded bg-surface-container-high border border-outline-variant/50 flex items-center justify-center transition-transform group-hover:scale-105">
              <div className="w-3 h-3 bg-primary-container rounded-[2px] transform rotate-45"></div>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold text-[16px] text-on-surface tracking-tight group-hover:text-primary transition-colors">
                Odds Monitor
              </span>
            </div>
          </div>

          <div className="h-4 w-px bg-outline-variant/40 hidden sm:block"></div>

          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container-low border border-outline-variant/30">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary-container animate-pulse"></span>
            <span className="font-mono text-[11px] text-on-surface-variant uppercase tracking-wider">
              internal · read only
            </span>
          </div>

          {/* Quick View Navigation Tabs */}
          <div className="hidden lg:flex items-center gap-1 ml-2 bg-surface-container-low p-1 rounded-md border border-outline-variant/30">
            <button
              onClick={() => onNavigate("dashboard")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-medium transition-all ${
                currentView === "dashboard"
                  ? "bg-surface-bright text-on-surface shadow-sm font-semibold"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
              }`}
            >
              <LayoutDashboard size={13} />
              <span>Dashboard</span>
            </button>
            <button
              disabled={!eventTitle}
              onClick={() => onNavigate("event-detail")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] font-medium transition-all ${
                currentView === "event-detail"
                  ? "bg-surface-bright text-on-surface shadow-sm font-semibold"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
              }`}
            >
              <FileText size={13} />
              <span>{eventTitle || "Event detail"}</span>
            </button>
          </div>
        </div>

        {/* Right Section: Sync, Direct Images link, Theme & Avatar */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Realtime Status */}
          <div className="hidden md:flex items-center gap-1.5 text-on-surface-variant font-mono text-[11px]">
            <span className="w-2 h-2 rounded-full bg-primary-container"></span>
            <span>{liveStatus}</span>
          </div>

          {/* Manual Sync Button */}
          <button
            onClick={onSync}
            disabled={isSyncing}
            className="h-7 px-2.5 flex items-center gap-1.5 rounded bg-surface-container-low border border-outline-variant/40 text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer disabled:opacity-50"
            title="Manual Sync"
            type="button"
          >
            <RefreshCw
              size={14}
              className={isSyncing ? "animate-spin text-primary" : ""}
            />
            <span className="font-semibold text-[11px] uppercase tracking-wider hidden sm:inline">
              Sync
            </span>
          </button>

          <div className="h-4 w-px bg-outline-variant/40"></div>

          {/* Theme Toggle Button */}
          <button
            onClick={onToggleTheme}
            className="w-7 h-7 rounded flex items-center justify-center bg-surface-container-low border border-outline-variant/40 text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer"
            title={
              isDarkMode ? "Mudar para modo claro" : "Mudar para modo escuro"
            }
            type="button"
          >
            {isDarkMode ? <Moon size={15} /> : <Sun size={15} />}
          </button>
        </div>
      </div>
    </header>
  );
};
