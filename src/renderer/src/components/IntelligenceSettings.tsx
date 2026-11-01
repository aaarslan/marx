import React, { useEffect, useState } from "react";
import type { IntelligenceSettings as Settings } from "@shared/intelligence";
import { api } from "../api";
import { Banner, Toggle } from "./ui";
import { notifyIntelligence } from "./IntelligencePanel";

export function IntelligenceSettings() {
  const [settings, setSettings] = useState<Settings | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    let current = true;
    void api.intelligence
      .settings()
      .then((value) => {
        if (current) setSettings(value);
      })
      .catch((error) => {
        if (current) setError(error.message);
      });
    return () => {
      current = false;
    };
  }, []);
  const save = async () => {
    if (!settings || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setSettings(await api.intelligence.configure(settings.enabledSources));
      notifyIntelligence();
      setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card intel-settings">
      <h2>Public CVE intelligence</h2>
      <p className="field-help">
        Optional, independent sources for findings with a CVE ID. All sources
        start disabled. Saving enables a source; network lookups happen only
        when you choose Refresh intelligence. No source code, package inventory,
        paths, Checkmarx credentials or tenant identifiers are sent.
      </p>
      <p className="field-help">
        Disabling a source cancels the active refresh. Cached observations and
        pinned evidence stay on this computer. Clearing the fetched cache
        preserves decision evidence, session evidence and watch history.
        Requests use HTTPS and the system trust store; there is no certificate
        bypass or paid fallback.
      </p>
      {error && <Banner kind="error">{error}</Banner>}
      {settings?.providers.map((source) => (
        <div key={source.id} className="intel-source">
          <Toggle
            checked={settings.enabledSources.includes(source.id)}
            label={source.name}
            sub={source.description}
            onChange={(checked) => {
              if (busy) return;
              setSaved(false);
              setSettings({
                ...settings,
                enabledSources: checked
                  ? [...settings.enabledSources, source.id]
                  : settings.enabledSources.filter(
                      (item) => item !== source.id,
                    ),
              });
            }}
          />
          <p className="faint mono">{source.host}</p>
        </div>
      ))}
      <div className="row">
        <button
          className="btn small"
          disabled={!settings || busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save intelligence preferences"}
        </button>
        <button
          className="btn ghost small"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void api.intelligence
              .clearCache()
              .then(() => {
                notifyIntelligence();
                setSaved(false);
              })
              .catch((error) => setError(error.message))
              .finally(() => setBusy(false));
          }}
        >
          Clear fetched cache
        </button>
        <span className="field-help" role="status">
          {saved ? "Intelligence preferences saved." : ""}
        </span>
      </div>
    </section>
  );
}
