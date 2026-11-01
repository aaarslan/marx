import React, { useEffect, useRef, useState } from "react";
import { Check, Search, ShieldCheck, Star, Trash2 } from "lucide-react";
import {
  findingCVE,
  intelligenceLabel,
  type IntelligenceWatchlist,
} from "@shared/intelligence";
import { api } from "../api";
import { useApp } from "../store";
import { Banner, Empty, Spinner, timeAgo } from "../components/ui";
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
    [error, setError] = useState<string | null>(null),
    [inputError, setInputError] = useState<string | null>(null),
    [pending, setPending] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const loadVersion = useRef(0);
  const mutation = useRef(false);
  const mounted = useRef(true);
  const {
    snapshots,
    error: lookupError,
    loading,
  } = useIntelligence(selected ? [selected] : []);
  const load = () => {
    const version = ++loadVersion.current;
    void api.intelligence
      .watchlist()
      .then((value) => {
        if (mounted.current && version === loadVersion.current) {
          setWatchlist(value);
          setError(null);
        }
      })
      .catch((error) => {
        if (mounted.current && version === loadVersion.current)
          setError(error.message);
      });
  };
  useEffect(() => {
    mounted.current = true;
    load();
    window.addEventListener("marx-intelligence-changed", load);
    return () => {
      mounted.current = false;
      loadVersion.current++;
      window.removeEventListener("marx-intelligence-changed", load);
    };
  }, []);
  const choose = (value: string) => {
    const id = findingCVE(value);
    if (!id) {
      setInputError("Enter a complete CVE ID, such as CVE-2021-44228.");
      search.current?.focus();
      return;
    }
    setSelected(id);
    setInput(id);
    setInputError(null);
    setNotice("");
  };
  const changeWatch = async (cve: string, remove: boolean) => {
    if (mutation.current) return;
    mutation.current = true;
    setPending(cve);
    setError(null);
    try {
      if (remove) await api.intelligence.unwatch(cve);
      else await api.intelligence.watch(cve);
      if (mounted.current) {
        setNotice(
          `${cve} ${remove ? "removed from" : "added to"} your watchlist.`,
        );
        load();
        notifyIntelligence();
      }
    } catch (error) {
      if (mounted.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      mutation.current = false;
      if (mounted.current) setPending(null);
    }
  };
  const watched = watchlist?.items.some((item) => item.cve === selected);
  return (
    <>
      <div className="page-eyebrow">Public context, local decisions</div>
      <h1 className="page-title">CVE intelligence</h1>
      <p className="page-sub">
        Understand exploitation signals and watch what changes. Lookups do not
        run scans or change Checkmarx findings.
      </p>
      <form
        className="intel-lookup card"
        onSubmit={(event) => {
          event.preventDefault();
          choose(input);
        }}
      >
        <label htmlFor="cve-lookup" className="intel-label">
          Find a vulnerability
        </label>
        <div className="intel-search">
          <input
            ref={search}
            id="cve-lookup"
            aria-label="CVE lookup"
            aria-describedby={
              inputError ? "cve-lookup-error" : "cve-lookup-hint"
            }
            aria-invalid={!!inputError}
            value={input}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="CVE-2021-44228"
            onChange={(event) => {
              setInput(event.target.value);
              setInputError(null);
            }}
          />
          <button
            className="btn primary"
            type="submit"
            disabled={!input.trim()}
          >
            <Search size={14} />
            Look up CVE
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => useApp.getState().setView("settings")}
          >
            Manage sources
          </button>
        </div>
        {inputError ? (
          <p id="cve-lookup-error" className="intel-input-error" role="alert">
            {inputError}
          </p>
        ) : (
          <p id="cve-lookup-hint" className="field-help">
            Look up cached context by CVE ID. Refresh explicitly to contact your
            enabled sources.
          </p>
        )}
      </form>
      {(error || lookupError) && (
        <Banner kind="warn">{error || lookupError}</Banner>
      )}
      <p className="intel-notice field-help" role="status">
        {notice}
      </p>
      <div className="intelligence-layout">
        <section className="card intel-watch" aria-labelledby="watchlist-title">
          <div className="row between">
            <h2 id="watchlist-title">Watchlist</h2>
            <span className="intel-count">
              {watchlist ? `${watchlist.items.length} / 200` : "—"}
            </span>
          </div>
          <p className="field-help">
            Follow CVEs you care about. Changes are recorded when you refresh,
            with no background requests.
          </p>
          <IntelligenceRefresh
            cves={watchlist?.items.map((item) => item.cve) ?? []}
            onComplete={load}
          />
          {!watchlist ? (
            <p className="intel-loading" role="status">
              {!error && <Spinner />}{" "}
              {error ? "Watchlist unavailable." : "Loading watchlist…"}
              {error && (
                <button className="btn ghost small" onClick={load}>
                  Try again
                </button>
              )}
            </p>
          ) : !watchlist.items.length ? (
            <Empty
              icon={<Star size={26} strokeWidth={1.5} />}
              title="Keep a CVE in sight"
              hint="Look up a CVE, then choose Watch CVE. Your first refresh establishes its baseline."
            />
          ) : (
            <div
              className="intel-watch-list"
              role="region"
              aria-label="Watched CVEs"
              tabIndex={0}
            >
              {watchlist.items.map((item) => (
                <div
                  className={`intel-watch-row ${selected === item.cve ? "selected" : ""}`}
                  key={item.cve}
                >
                  <button
                    className="btn ghost small"
                    aria-current={selected === item.cve ? "true" : undefined}
                    onClick={() => choose(item.cve)}
                  >
                    <span className="mono">{item.cve}</span>
                    <span className="field-help">
                      {intelligenceLabel(watchlist.snapshots[item.cve])}
                    </span>
                  </button>
                  <button
                    className="btn ghost small icon"
                    disabled={!!pending}
                    aria-label={`Stop watching ${item.cve}`}
                    onClick={() => void changeWatch(item.cve, true)}
                  >
                    {pending === item.cve ? (
                      <Spinner size={13} />
                    ) : (
                      <Trash2 size={13} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        <section
          className="card intel-lookup-result"
          aria-label="CVE details"
          aria-busy={loading}
        >
          {selected ? (
            <>
              <div className="row between intel-detail-header">
                <h2 className="mono">{selected}</h2>
                <button
                  className={`btn small ${watched ? "selected" : "ghost"}`}
                  disabled={!watchlist}
                  aria-disabled={!!pending}
                  aria-pressed={!!watched}
                  onClick={() => void changeWatch(selected, !!watched)}
                >
                  {pending === selected ? (
                    <Spinner size={13} />
                  ) : watched ? (
                    <Check size={13} />
                  ) : (
                    <Star size={13} />
                  )}
                  {watched ? "Watching" : "Watch CVE"}
                </button>
              </div>
              <IntelligenceRefresh cves={[selected]} onComplete={load} />
              {loading && !snapshots[selected] ? (
                <p className="intel-loading" role="status">
                  <Spinner /> Reading cached intelligence…
                </p>
              ) : (
                <IntelligenceFacts snapshot={snapshots[selected]} />
              )}
            </>
          ) : (
            <Empty
              icon={<ShieldCheck size={34} strokeWidth={1.4} />}
              title="Bring a CVE into focus"
              hint="Enter an exact CVE ID or select a watched item. Inspect known exploitation, published probability and the source behind each signal."
              action={
                <span className="intel-state">
                  Sources are opt-in · cached context works offline
                </span>
              }
            />
          )}
        </section>
      </div>
      <section className="card intel-history">
        <div className="row between">
          <h2>Observed changes</h2>
          <span className="intel-count">
            {watchlist?.events.length ?? 0} recent
          </span>
        </div>
        <p className="field-help">
          Latest 100 events from your 200-event local history. Stopping a watch
          preserves earlier events. This is a record of your observations, not a
          complete threat timeline.
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
                <time
                  className="faint"
                  dateTime={new Date(event.at).toISOString()}
                  title={new Date(event.at).toLocaleString()}
                >
                  {timeAgo(new Date(event.at).toISOString())}
                </time>
              </div>
              <ul>
                {event.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </article>
          ))
        ) : (
          <div className="intel-history-empty">
            <Check size={16} />
            <p>
              No observed changes yet. A later refresh can record changes from
              your first observation.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
