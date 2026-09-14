import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { EventDetailView } from './components/EventDetailView';
import { NeedsAttentionDrawer } from './components/NeedsAttentionDrawer';
import { EventInspectionModal } from './components/EventInspectionModal';
import { DirectImagesModal } from './components/DirectImagesModal';
import { Footer } from './components/Footer';
import { 
  PROVIDER_METRICS, 
  OPERATIONAL_EVENTS, 
  ISSUES_LIST 
} from './data/mockData';
import { OperationalOddsEvent, IssueItem, ProviderMetric } from './types';
import { Check, Info } from 'lucide-react';

export default function App() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'event-detail'>('dashboard');
  const [isIssuesDrawerOpen, setIsIssuesDrawerOpen] = useState(false);
  const [isInspectionModalOpen, setIsInspectionModalOpen] = useState(false);
  const [selectedInspectionEvent, setSelectedInspectionEvent] = useState<OperationalOddsEvent | null>(null);
  const [isDirectImagesModalOpen, setIsDirectImagesModalOpen] = useState(false);
  
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [lastUpdatedSeconds, setLastUpdatedSeconds] = useState(18);
  const [isSyncing, setIsSyncing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderMetric[]>(PROVIDER_METRICS);
  const [events, setEvents] = useState<OperationalOddsEvent[]>(OPERATIONAL_EVENTS);
  const [issues, setIssues] = useState<IssueItem[]>(ISSUES_LIST);

  // Sync dark mode class with document root
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Live timer for "Updated Xs ago"
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdatedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 3000);
  };

  const handleSync = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      setLastUpdatedSeconds(1);
      showToast('All 4 bookmaker feeds synced successfully · Latency: 14ms');
    }, 850);
  };

  const handleOpenEventDetail = (eventId: string) => {
    setCurrentView('event-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenInspectionModal = (event: OperationalOddsEvent) => {
    setSelectedInspectionEvent(event);
    setIsInspectionModalOpen(true);
  };

  const handleInspectIssue = (issue: IssueItem) => {
    setIsIssuesDrawerOpen(false);
    if (issue.eventId === 'iem-cologne-2025-m39') {
      setCurrentView('event-detail');
    } else {
      const foundEvent = events.find((e) => e.id === issue.eventId) || events[1];
      setSelectedInspectionEvent(foundEvent);
      setIsInspectionModalOpen(true);
    }
  };

  const handleBatchAcknowledge = () => {
    setIssues([]);
    setIsIssuesDrawerOpen(false);
    showToast('Batch acknowledged all 7 active issues.');
  };

  const handleResolveSingleIssue = (issueId: string) => {
    setIssues((prev) => prev.filter((i) => i.id !== issueId));
    showToast('Issue marked as resolved.');
  };

  const handleBlacklistProvider = (providerName: string) => {
    showToast(`Quarantined and blacklisted ${providerName} for this market.`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface-container-lowest text-on-surface antialiased transition-colors duration-200">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed top-16 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-container-high border border-primary/40 text-on-surface shadow-xl animate-fade-in text-[12px] font-mono">
          <Check size={14} className="text-primary" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main App Header */}
      <Header
        currentView={currentView}
        onNavigate={(view) => setCurrentView(view)}
        onOpenIssues={() => setIsIssuesDrawerOpen(true)}
        onOpenDirectImages={() => setIsDirectImagesModalOpen(true)}
        issueCount={issues.length}
        lastUpdatedSeconds={lastUpdatedSeconds}
        onSync={handleSync}
        isSyncing={isSyncing}
        isDarkMode={isDarkMode}
        onToggleTheme={() => setIsDarkMode(!isDarkMode)}
      />

      {/* Main Screen Content */}
      <main className="w-full pt-14 flex-1 flex flex-col">
        {currentView === 'dashboard' ? (
          <DashboardView
            providers={providers}
            events={events}
            onOpenIssuesDrawer={() => setIsIssuesDrawerOpen(true)}
            onOpenEventDetail={handleOpenEventDetail}
            onOpenInspectionModal={handleOpenInspectionModal}
            issueCount={issues.length}
          />
        ) : (
          <EventDetailView
            onBackToDashboard={() => setCurrentView('dashboard')}
            onSyncEvent={handleSync}
            isSyncing={isSyncing}
          />
        )}
      </main>

      {/* Slide-over Issues Drawer */}
      <NeedsAttentionDrawer
        isOpen={isIssuesDrawerOpen}
        onClose={() => setIsIssuesDrawerOpen(false)}
        issues={issues}
        onInspectIssue={handleInspectIssue}
        onBatchAcknowledge={handleBatchAcknowledge}
        onResolveSingleIssue={handleResolveSingleIssue}
      />

      {/* Outlier Inspection Modal */}
      <EventInspectionModal
        isOpen={isInspectionModalOpen}
        onClose={() => setIsInspectionModalOpen(false)}
        event={selectedInspectionEvent}
        onBlacklistProvider={handleBlacklistProvider}
      />

      {/* Direct Images & HTML Explanation Modal */}
      <DirectImagesModal
        isOpen={isDirectImagesModalOpen}
        onClose={() => setIsDirectImagesModalOpen(false)}
        onNavigateToScreen={(screen) => setCurrentView(screen)}
      />

      {/* Global Footer */}
      <Footer />
    </div>
  );
}
