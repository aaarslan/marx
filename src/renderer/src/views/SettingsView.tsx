import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, KeyRound, Plug } from 'lucide-react';
import type { ScanDefaults, Settings, TestConnectionResult } from '@shared/types';
import { api } from '../api';
import { useApp } from '../store';
import { Banner, Spinner, Toggle } from '../components/ui';

export function SettingsView() {
  const { settings, init } = useApp();
  const [cliPath, setCliPath] = useState('');
  const [cliConfigPath, setCliConfigPath] = useState('');
  const [cliAuthMode, setCliAuthMode] = useState<Settings['cliAuthMode']>('cli');
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
      setCliPath(settings.cliPath);
      setCliConfigPath(settings.cliConfigPath);
      setCliAuthMode(settings.cliAuthMode);
      setBaseUrl(settings.baseUrl);
      setTenant(settings.tenant);
      setDefaults(settings.defaults);
    }
  }, [settings?.baseUrl, settings?.tenant, settings?.defaults]);

  useEffect(() => { setTestResult(null); setTestError(null); }, [cliPath, cliConfigPath, cliAuthMode, baseUrl, tenant]);

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
      await api.settings.save({ cliPath: cliPath.trim(), cliConfigPath: cliConfigPath.trim(), cliAuthMode, baseUrl: baseUrl.trim(), tenant: tenant.trim(), defaults });
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
      await api.settings.save({ cliPath: cliPath.trim(), cliConfigPath: cliConfigPath.trim(), cliAuthMode, baseUrl: baseUrl.trim(), tenant: tenant.trim() });
      await init();
      setTestResult(await api.settings.testConnection());
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
      <p className="page-sub">Use your working Checkmarx CLI installation and choose defaults for future scans.</p>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>Official Checkmarx CLI</div>
        <div className="col">
          <p className="field-help">Marx runs the CLI on demand. The CLI uploads selected source to Checkmarx One and retrieves the scan results.</p>
          <label className="field">
            CLI executable
            <div className="row">
              <input type="text" aria-label="CLI executable" value={cliPath} onChange={(event) => setCliPath(event.target.value)} placeholder="Auto-detect cx from PATH" style={{ flex: 1 }} />
              <button className="btn" disabled={testing || saving} onClick={async () => {
                try { const selected = await api.dialog.selectCli(); if (selected) { setCliPath(selected); setTestResult(null); } }
                catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); }
              }}>Browse…</button>
            </div>
            <span className="faint">Select the same cx executable that works in your terminal. Marx does not download or replace your CLI.</span>
          </label>
          <label className="field">
            CLI configuration file (optional)
            <input type="text" aria-label="CLI configuration file" value={cliConfigPath} onChange={(event) => setCliConfigPath(event.target.value)} placeholder="Use the CLI’s default configuration file" />
            <span className="faint">Use an absolute path if your working command specifies --config-file-path. Existing proxy and certificate settings are handled by the CLI.</span>
          </label>
          <label className="field">
            Authentication
            <select aria-label="Authentication source" value={cliAuthMode} onChange={(event) => { setCliAuthMode(event.target.value as Settings['cliAuthMode']); setTestResult(null); }}>
              <option value="cli">Use the CLI’s existing configuration</option>
              <option value="marx">Use an API key saved in Marx</option>
            </select>
            <span className="faint">Existing CLI configuration is recommended when scans already work in your terminal. Marx does not modify it. Shell-only environment variables must also be available to the app, or configured in your CLI configuration file.</span>
          </label>
          <button className="btn primary" disabled={testing || savingKey || saving} onClick={() => void test()}>
            {testing ? <Spinner size={13} /> : <Plug size={13} />}
            {testing ? 'Testing CLI…' : 'Test CLI connection'}
          </button>
          {testResult && <Banner kind="ok">{testResult.message}<div className="mono">{testResult.cliPath}</div></Banner>}
          {testError && <Banner kind="error">{testError}</Banner>}
        </div>
      </div>

      {!settings.credentialStorageAvailable && <Banner kind="warn">Protected credential storage is unavailable. Use the CLI’s existing configuration. Marx will not save or read a plaintext API key; any existing key file is left unchanged.</Banner>}

      {cliAuthMode === 'marx' && <>
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
                disabled={savingKey || !settings.credentialStorageAvailable}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings.hasApiKey ? '••••••••••••  (enter a new key to replace)' : 'Paste your Checkmarx One API key'}
                style={{ flex: 1 }}
              />
              <button className="btn" disabled={!apiKey.trim() || !settings.credentialStorageAvailable || savingKey || saving || testing} onClick={() => void saveKey()}>
                {savingKey ? <Spinner size={12} /> : null}{savingKey ? 'Saving…' : 'Save key'}
              </button>
            </div>
            <span className="faint">
              Generate a key in Checkmarx One → Settings → API keys. Keys saved in Marx require your operating system’s protected storage.
            </span>
          </label>

          {settings.hasStoredApiKey && <button className="btn small" disabled={savingKey || saving || testing} onClick={async () => {
            setSavingKey(true);
            setSaveError(null);
            try { await api.settings.setApiKey(''); await init(); setTestResult(null); }
            catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); }
            finally { setSavingKey(false); }
          }}>Remove saved key</button>}

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

          {keySaved && <Banner kind="ok">API key saved. Test the CLI connection to verify access.</Banner>}
        </div>
      </div>

      </>}

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
