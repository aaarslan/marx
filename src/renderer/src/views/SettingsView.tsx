import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, KeyRound, Plug } from 'lucide-react';
import type { ScanDefaults, TestConnectionResult } from '@shared/types';
import { api } from '../api';
import { useApp } from '../store';
import { Banner, Spinner, Toggle } from '../components/ui';

export function SettingsView() {
  const { settings, init } = useApp();
  const [baseUrl, setBaseUrl] = useState('');
  const [tenant, setTenant] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaults, setDefaults] = useState<ScanDefaults | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const initialized = useRef(false);
  const [saving, setSaving] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (settings && !initialized.current) {
      initialized.current = true;
      setBaseUrl(settings.baseUrl);
      setTenant(settings.tenant);
      setDefaults(settings.defaults);
    }
  }, [settings?.baseUrl, settings?.tenant, settings?.defaults]);

  useEffect(() => {
    if (!savedFlash && !keySaved) return;
    const timer = setTimeout(() => { setSavedFlash(false); setKeySaved(false); }, 2500);
    return () => clearTimeout(timer);
  }, [savedFlash, keySaved]);

  if (!settings || !defaults) return <div className="empty" role="status"><Spinner /> Loading settings…</div>;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.settings.save({ baseUrl: baseUrl.trim(), tenant: tenant.trim(), defaults });
      await init();
      setSavedFlash(true);
    } catch (e) { setSaveError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const saveKey = async () => {
    if (!apiKey.trim() || savingKey) return;
    setSavingKey(true);
    setSaveError(null);
    setTestResult(null);
    setTestError(null);
    try {
      await api.settings.setApiKey(apiKey.trim());
      setApiKey('');
      await init();
      setKeySaved(true);
    } catch (e) { setSaveError(e instanceof Error ? e.message : String(e)); }
    finally { setSavingKey(false); }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      if (baseUrl.trim() !== settings.baseUrl || tenant.trim() !== settings.tenant) {
        await api.settings.save({ baseUrl: baseUrl.trim(), tenant: tenant.trim() });
        await init();
      }
      const r = await api.settings.testConnection();
      setTestResult(r);
      // remember the resolved base so deep links work without manual config
      if (r.apiBase) {
        await api.settings.save({ baseUrl: r.apiBase });
        setBaseUrl(r.apiBase);
        await init();
      }
    } catch (e) {
      setTestError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
<div className="page-eyebrow">Preferences</div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Connect your account and choose defaults for future scans.</p>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          <KeyRound size={14} /> Checkmarx One access
        </div>
        <div className="col">
          <label className="field">
            API key {settings.hasApiKey ? <span className="badge completed" style={{ fontSize: 10 }}>saved</span> : null}
            <div className="row">
              <input
                type="password"
                aria-label="Checkmarx API key"
                autoComplete="off"
                spellCheck={false}
                disabled={savingKey}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings.hasApiKey ? '••••••••••••  (enter a new key to replace)' : 'Paste your Checkmarx One API key'}
                style={{ flex: 1 }}
              />
              <button className="btn" disabled={!apiKey.trim() || savingKey || saving || testing} onClick={() => void saveKey()}>
                {savingKey ? <Spinner size={12} /> : null}{savingKey ? 'Saving…' : 'Save key'}
              </button>
            </div>
            <span className="faint">
              Generate a key in Checkmarx One → Settings → API keys. Credentials use your operating system’s protected storage when available.
            </span>
          </label>

          <details className="advanced-connection">
            <summary>Advanced connection settings</summary>
            <p className="field-help">Usually detected from your API key. Override these only if your tenant requires it.</p>
          <div className="grid-2">
            <label className="field">
              Base URL (optional — auto-detected from the key)
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://tenant.ast.checkmarx.net"
              />
            </label>
            <label className="field">
              Tenant (only if the key doesn’t self-describe)
              <input
                type="text"
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                placeholder="my-company"
              />
            </label>
          </div>
          </details>

          <div className="row">
            <button className="btn primary" disabled={testing || savingKey || saving} onClick={() => void test()}>
              {testing ? <Spinner size={13} /> : <Plug size={13} />}
              {testing ? 'Testing connection…' : 'Test connection'}
            </button>
            {testResult && (
              <span className="dim mono" style={{ fontSize: 11 }}>
                {testResult.apiBase}
              </span>
            )}
          </div>
          {keySaved && <Banner kind="ok">API key saved. Test the connection to verify access.</Banner>}
          {testResult && (
            <Banner kind="ok">
              Connected to {testResult.apiBase} via {testResult.authEndpoint}
            </Banner>
          )}
          {testError && <Banner kind="error">{testError}</Banner>}
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>Scan defaults</div>
        <div className="col">
          <label className="field">
            SAST preset
            <input
              type="text"
              value={defaults.sastPreset}
              onChange={(e) => setDefaults({ ...defaults, sastPreset: e.target.value })}
            />
          </label>
          <Toggle
            checked={defaults.sastIncremental}
            onChange={(sastIncremental) => setDefaults({ ...defaults, sastIncremental })}
            label="SAST incremental by default"
            sub="faster re-scans; requires one prior full scan per project"
          />
          <Toggle
            checked={defaults.scaExploitablePath}
            onChange={(scaExploitablePath) => setDefaults({ ...defaults, scaExploitablePath })}
            label="SCA Exploitable Path by default"
            sub="reachability analysis (Java, JS, Python, C#)"
          />
          <label className="field">
            Batch concurrency
            <input
              type="number"
              min={1}
              max={8}
              value={defaults.batchConcurrency}
              onChange={(e) =>
                setDefaults({ ...defaults, batchConcurrency: Math.max(1, Math.min(8, Number(e.target.value) || 2)) })
              }
              style={{ width: 80 }}
            />
          </label>
          <label className="field">
            Extra excludes (comma-separated)
            <input
              type="text"
              value={defaults.extraExcludes.join(', ')}
              onChange={(e) =>
                setDefaults({
                  ...defaults,
                  extraExcludes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                })
              }
              placeholder="e2e-fixtures, storybook-static"
            />
          </label>
        </div>
      </div>

      {saveError && <Banner kind="error">{saveError}</Banner>}
      <div className="settings-actions">
        <button className="btn primary" disabled={saving || savingKey || testing} onClick={() => void save()}>
          {saving ? <Spinner size={13} /> : savedFlash ? <CheckCircle2 size={14} /> : null}
          {saving ? 'Saving…' : savedFlash ? 'Settings saved' : 'Save settings'}
        </button>
        <span className="field-help" role="status">{savedFlash ? 'Your preferences are up to date.' : 'Applies to new scans.'}</span>
      </div>
    </>
  );
}
