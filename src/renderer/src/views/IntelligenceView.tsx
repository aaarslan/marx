import React, { useEffect, useState } from "react";
import { Search, Star, Trash2 } from "lucide-react";
import {
  findingCVE,
  intelligenceLabel,
  type IntelligenceWatchlist,
} from "@shared/intelligence";
import { api } from "../api";
import { useApp } from "../store";
import { Banner, timeAgo } from "../components/ui";
import {
  IntelligenceFacts,
  IntelligenceRefresh,
  notifyIntelligence,
  useIntelligence,
} from "../components/IntelligencePanel";

export function IntelligenceView() {
  const [input, setInput] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [watchlist, setWatchlist] = useState<IntelligenceWatchlist | null>(null),
    [error, setError] = useState<string | null>(null);
  const { snapshots, error: lookupError } = useIntelligence(
    selected ? [selected] : [],
  );
  const load = () => {
    void api.intelligence
      .watchlist()
      .then(setWatchlist)
      .catch((error) => setError(error.message));
  };
  useEffect(() => {
    load();
    window.addEventListener("marx-intelligence-changed", load);
    return () => window.removeEventListener("marx-intelligence-changed", load);
  }, []);
  const choose = (value: string) => {
    const id = findingCVE(value);
    if (!id) {
      setError("Enter a complete CVE ID, such as CVE-2021-44228");
      return;
    }
    setSelected(id);
    setInput(id);
    setError(null);
  };
  return (
    <>
      <div className="page-eyebrow">Public context, local decisions</div>
      <h1 className="page-title">CVE intelligence</h1>
      <p className="page-sub">
        Understand exploitation signals and watch what changes. Lookups do not
        run scans or change Checkmarx findings.
      </p>
      <div className="toolbar">
        <form
          className="intel-search"
          onSubmit={(event) => {
            event.preventDefault();
            choose(input);
          }}
        >
          <input
            aria-label="CVE lookup"
            value={input}
            maxLength={40}
            placeholder="CVE-2021-44228"
            onChange={(event) => setInput(event.target.value)}
          />
          <button className="btn small" type="submit">
            <Search size={14} />
            Look up CVE
          </button>
        </form>
        <button
          className="btn ghost small"
          onClick={() => useApp.getState().setView("settings")}
        >
          Manage sources
        </button>
      </div>
      {(error || lookupError) && (
        <Banner kind="warn">{error || lookupError}</Banner>
      )}
      <div className="intelligence-layout">
        <section className="card intel-watch">
          <div className="row between">
            <h2>Watchlist</h2>
            <span className="faint">{watchlist?.items.length ?? 0} / 200</span>
          </div>
          <p className="field-help">
            A refresh records changes since the preceding observation. The first
            observation is a baseline. There is no scheduled background traffic.
          </p>
          <IntelligenceRefresh
            cves={watchlist?.items.map((item) => item.cve) ?? []}
            onComplete={load}
          />
          {!watchlist?.items.length && (
            <p className="field-help">
              Look up a CVE or choose Watch CVE in a finding to start.
            </p>
          )}
          {watchlist?.items.map((item) => (
            <div
              className={`intel-watch-row ${selected === item.cve ? "selected" : ""}`}
              key={item.cve}
            >
              <button
                className="btn ghost small"
                onClick={() => choose(item.cve)}
              >
                <span className="mono">{item.cve}</span>
                <span className="field-help">
                  {intelligenceLabel(watchlist.snapshots[item.cve])}
                </span>
              </button>
              <button
                className="btn ghost small icon"
                aria-label={`Stop watching ${item.cve}`}
                onClick={() =>
                  void api.intelligence
                    .unwatch(item.cve)
                    .then(() => {
                      load();
                      notifyIntelligence();
                    })
                    .catch((error) => setError(error.message))
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </section>
        <section className="card">
          {selected ? (
            <>
              <div className="row between">
                <h2 className="mono">{selected}</h2>
                <button
                  className="btn ghost small"
                  onClick={() =>
                    void api.intelligence
                      .watch(selected)
                      .then(() => {
                        load();
                        notifyIntelligence();
                      })
                      .catch((error) => setError(error.message))
                  }
                >
                  <Star size={13} />
                  Watch CVE
                </button>
              </div>
              <IntelligenceRefresh cves={[selected]} onComplete={load} />
              <IntelligenceFacts snapshot={snapshots[selected]} />
            </>
          ) : (
            <>
              <h2>Choose a CVE</h2>
              <p className="field-help">
                Open a watched item or enter an exact CVE ID. Cached context
                remains readable offline. Source data can be incomplete, stale
                or disputed.
              </p>
            </>
          )}
        </section>
      </div>
      <section className="card intel-history">
        <h2>Observed changes</h2>
        <p className="field-help">
          Latest 100 events from the 200-event local watch history. Stopping a
          watch preserves its earlier events. These are differences between
          local observations, not a complete threat timeline.
        </p>
        {watchlist?.events.length ? (
          watchlist.events.map((event) => (
            <article key={event.id}>
              <div className="row between">
                <button
                  className="btn ghost small mono"
                  onClick={() => choose(event.cve)}
                >
                  {event.cve}
                </button>
                <span className="faint">
                  {timeAgo(new Date(event.at).toISOString())}
                </span>
              </div>
              <ul>
                {event.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </article>
          ))
        ) : (
          <p className="field-help">No observed changes yet.</p>
        )}
      </section>
    </>
  );
}
