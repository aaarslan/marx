import { useShallow } from 'zustand/react/shallow';
import { hasScanCredentials } from '@shared/types';
import React, { useEffect, useState } from 'react';
import { ExternalLink, History as HistoryIcon, RefreshCw } from 'lucide-react';
import type { ScanHistoryItem } from '@shared/types';
import { api } from '../api';
import { useApp } from '../store';
import { Banner, Empty, StatusBadge, timeAgo } from '../components/ui';

export function HistoryView() {
  const { settings, setSelectedScan, setView, historyVersion } = useApp(useShallow((state) => ({
    settings: state.settings,
    setSelectedScan: state.setSelectedScan,
    setView: state.setView,
    historyVersion: state.historyVersion
  })));
  const [items, setItems] = useState<ScanHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!hasScanCredentials(settings)) return;
    setLoading(true);
    setError(null);
    api.scan
      .history()
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  // refresh when scans settle (new completions appear automatically)
  useEffect(load, [settings?.cliAuthMode, settings?.hasApiKey, settings?.cliPath, settings?.cliConfigPath, historyVersion]);

  if (!hasScanCredentials(settings)) {
    return (
      <>
        <div className="page-eyebrow">Scan activity</div><h1 className="page-title">History</h1>
        <Empty icon={<HistoryIcon size={32} strokeWidth={1.5} />} title="Your scan history starts here" hint="Connect your Checkmarx One account to revisit scans and compare results across branches." action={<button className="btn primary" onClick={() => setView('settings')}>Connect account</button>} />
      </>
    );
  }

  return (
    <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <div>
          <div className="page-eyebrow">Scan activity</div><h1 className="page-title">History</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Last 50 scans across all projects.
          </p>
        </div>
        <button className="btn ghost small" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {loading && <div className="field-help" role="status">Loading recent scans…</div>}
      {error && <Banner kind="error">{error}</Banner>}

      {items.length === 0 && !loading && !error && (
        <Empty
          icon={<HistoryIcon size={38} strokeWidth={1.2} />}
          title="No scans yet"
          hint="Run your first scan from the Scan tab."
        />
      )}

      {items.length > 0 && (
        <div className="scroller">
          <table className="data history-table" aria-label="Scan history">
            <thead>
              <tr>
                <th style={{ width: '30%' }}>Project</th>
                <th style={{ width: '19%' }}>Branch</th>
                <th style={{ width: '14%' }}>Status</th>
                <th style={{ width: '13%' }}>Created</th>
                <th style={{ width: '12%' }}>Scan ID</th>
                <th style={{ width: '12%' }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr key={h.id}>
                  <td>
                    <div className="history-project">{h.projectName}</div>
                    {h.tags && Object.keys(h.tags).length > 0 && (
                      <div className="faint" style={{ fontSize: 10.5 }}>
                        {Object.entries(h.tags).map(([k, v]) => `${k}:${v}`).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="mono dim">{h.branch}</td>
                  <td>
                    <StatusBadge status={h.status} />
                  </td>
                  <td className="dim" title={h.createdAt}>{timeAgo(h.createdAt)}</td>
                  <td className="faint mono" title={h.id}>
                    {h.id.length > 13 ? `${h.id.slice(0, 13)}…` : h.id}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      <button
                        className="btn ghost small"
                        onClick={() => {
                          setSelectedScan(h.id, null);
                          setView('results');
                        }}
                      >
                        Results
                      </button>
                      {settings.baseUrl && (
                        <button
                          className="btn ghost small"
                          title="Open in Checkmarx One"
                          aria-label={`Open ${h.projectName} in Checkmarx One`}
                          onClick={() =>
                            void api.shell.openExternal(
                              `${settings.baseUrl!.replace(/\/+$/, '')}/projects/${h.projectId}/results?scanIds=${h.id}`
                            )
                          }
                        >
                          <ExternalLink size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
