import { hasScanCredentials } from '@shared/types';
import React, { lazy, Suspense, useEffect } from 'react';
import { FolderSearch, Layers, ListChecks, ScanSearch, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { useApp, type View } from './store';
import { api, isMac } from './api';
import { ScanView } from './views/ScanView';

const BatchView = lazy(() => import('./views/BatchView').then((m) => ({ default: m.BatchView })));
const ResultsView = lazy(() => import('./views/ResultsView').then((m) => ({ default: m.ResultsView })));
const HistoryView = lazy(() => import('./views/HistoryView').then((m) => ({ default: m.HistoryView })));
const SettingsView = lazy(() => import('./views/SettingsView').then((m) => ({ default: m.SettingsView })));

const NAV: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: 'scan', label: 'Scan', icon: <ScanSearch size={16} /> },
  { id: 'batch', label: 'Batch Scan', icon: <Layers size={16} /> },
  { id: 'results', label: 'Results', icon: <ListChecks size={16} /> },
  { id: 'history', label: 'History', icon: <FolderSearch size={16} /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={16} /> }
];

export function App() {
  const { view, setView, init, triggerMenuAction, settings } = useApp();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    // ⌘R / ⌘O always land on the Scan view
    const off = api.onMenuAction((action) => {
      triggerMenuAction(action);
      setView('scan');
    });
    return off;
  }, [setView, triggerMenuAction]);

  return (
    <>
      {isMac && <div className="drag-region" />}
      <div className={`app${isMac ? '' : ' native-frame'}`}>
        <aside className="sidebar" aria-label="Main navigation">
          <div className="app-title">
            <span className="logo">
              <ShieldCheck size={13} />
            </span>
            <span>Marx<small>Checkmarx One</small></span>
          </div>
          <div className="nav-label">Workspace</div>
          {NAV.map((n) => (
            <button
              type="button"
              key={n.id}
              className={`nav-item ${view === n.id ? 'active' : ''}`}
              aria-current={view === n.id ? 'page' : undefined}
              aria-label={n.label}
              title={n.label}
              onClick={() => setView(n.id)}
            >
              {n.icon}
              <span className="nav-text">{n.label}</span>
            </button>
          ))}
          <div className="nav-spacer" />
          <button className="connection-status" aria-label={hasScanCredentials(settings) ? 'Manage connection' : 'Set up connection'} title="Connection settings" onClick={() => setView('settings')}>
            <span className={`connection-dot ${hasScanCredentials(settings) ? 'configured' : ''}`} />
            <span>{hasScanCredentials(settings) ? 'Checkmarx CLI' : 'Set up connection'}<small>{hasScanCredentials(settings) ? 'Manage CLI and defaults' : 'Connect to start scanning'}</small></span>
            <SettingsIcon size={14} aria-hidden="true" />
          </button>
        </aside>
        <main className={`main ${view === 'scan' || view === 'settings' ? 'narrow' : ''}`}>
          <div className="page-content">
          <div hidden={view !== 'scan'}><ScanView /></div>
          <Suspense fallback={<div className="field-help" role="status">Loading view…</div>}>
          {view === 'batch' && <BatchView />}
          {view === 'results' && <ResultsView />}
          {view === 'history' && <HistoryView />}
          {view === 'settings' && <SettingsView />}
          </Suspense>
          </div>
        </main>
      </div>
    </>
  );
}
