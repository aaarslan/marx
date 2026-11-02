import React, { useEffect, useState } from "react";
import type { IntelligenceSettings as Settings } from "@shared/intelligence";
import { api } from "../api";
import { Banner, Spinner, Toggle } from "./ui";
import { notifyIntelligence } from "./IntelligencePanel";

export function IntelligenceSettings() {
  const [settings, setSettings] = useState<Settings | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState<"save" | "clear" | null>(null),
    [savedSources, setSavedSources] = useState(""),
    [notice, setNotice] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    let current = true;
    void api.intelligence
      .settings()
      .then((value) => {
        if (current) {
          setSettings(value);
          setSavedSources([...value.enabledSources].sort().join(","));
        }
      })
      .catch((error) => {
        if (current) setError(error.message);
      });
    return () => {
      current = false;
    };
  }, []);
  const dirty =
    !!settings &&
    [...settings.enabledSources].sort().join(",") !== savedSources;
  const save = async () => {
    if (!settings || busy) return;
    setBusy("save");
    setError(null);
    setSaved(false);
    try {
      const value = await api.intelligence.configure(settings.enabledSources);
      setSettings(value);
      setSavedSources([...value.enabledSources].sort().join(","));
      notifyIntelligence();
      setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card intel-settings">
      <div className="row between">
        <h2>Public CVE intelligence</h2>
        {dirty && <span className="intel-state">Unsaved changes</span>}
      </div>
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
      {!settings && !error && (
        <p className="intel-loading" role="status">
          <Spinner /> Loading source preferences…
        </p>
      )}
      {settings?.providers.map((source) => (
        <div key={source.id} className="intel-source">
          <Toggle
            checked={settings.enabledSources.includes(source.id)}
            disabled={!!busy}
            label={source.name}
            sub={source.description}
            onChange={(checked) => {
              if (busy) return;
              setSaved(false);
              setNotice("");
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
          disabled={!settings || !!busy || !dirty}
          onClick={() => void save()}
        >
          {busy === "save" && <Spinner size={13} />}
          {busy === "save" ? "Saving…" : "Save intelligence preferences"}
        </button>
        <button
          className="btn ghost small"
          disabled={!!busy || !settings}
          onClick={() => {
            setBusy("clear");
            setNotice("");
            setError(null);
            void api.intelligence
              .clearCache()
              .then(() => {
                notifyIntelligence();
                setSaved(false);
                setNotice(
                  "Fetched cache cleared. Pinned evidence and watch history were kept.",
                );
              })
              .catch((error) => setError(error.message))
              .finally(() => setBusy(null));
          }}
        >
          {busy === "clear" && <Spinner size={13} />}
          {busy === "clear" ? "Clearing…" : "Clear fetched cache"}
        </button>
        <span className="field-help" role="status">
          {notice ||
            (saved
              ? "Intelligence preferences saved."
              : dirty
                ? "Save to apply source changes."
                : "")}
        </span>
      </div>
    </section>
  );
}
