import React, { useEffect, useState, useRef } from "react";
import {
  ArrowLeft,
  ClipboardCheck,
  Download,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  DECISION_LABELS,
  type IntelligenceDecision,
} from "@shared/intelligence";
import { api } from "../api";
import { useApp } from "../store";
import { Banner, Empty, Spinner, timeAgo } from "./ui";
import {
  DecisionDialog,
  IntelligenceFacts,
  IntelligenceRefresh,
  notifyIntelligence,
} from "./IntelligencePanel";

export function DecisionReview() {
  const connection = useApp((state) => state.connectionId);
  const [items, setItems] = useState<IntelligenceDecision[]>([]),
    [error, setError] = useState<string | null>(null),
    [selected, setSelected] = useState<IntelligenceDecision | null>(null),
    [editing, setEditing] = useState(false),
    [filter, setFilter] = useState("open"),
    [history, setHistory] = useState<IntelligenceDecision[]>([]),
    [historyLoading, setHistoryLoading] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const returnFocus = useRef<string | null>(null);
  const loadVersion = useRef(0);
  const load = () => {
    const request = ++loadVersion.current;
    void api.intelligence
      .decisions()
      .then((data) => {
        if (
          request !== loadVersion.current ||
          connection !== useApp.getState().connectionId
        )
          return;
        setError(null);
        setLoading(false);
        setItems(data);
        setSelected((current) =>
          current
            ? (data.find((item) => item.id === current.id) ?? null)
            : null,
        );
      })
      .catch((error) => {
        if (request === loadVersion.current) {
          setError(error.message);
          setLoading(false);
        }
      });
  };
  useEffect(() => {
    setSelected(null);
    setEditing(false);
    setItems([]);
    setLoading(true);
    load();
    const timer = setInterval(load, 60000);
    window.addEventListener("marx-intelligence-changed", load);
    return () => {
      loadVersion.current++;
      clearInterval(timer);
      window.removeEventListener("marx-intelligence-changed", load);
    };
  }, [connection]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      load();
      notifyIntelligence();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let current = true;
    setHistory([]);
    setHistoryLoading(!!selected);
    setReason("");
    const attention = items.filter(
      (item) => !["active", "closed"].includes(item.reviewState),
    ).length;
    const back = () => {
      setSelected(null);
      requestAnimationFrame(() => {
        if (returnFocus.current)
          document
            .querySelector<HTMLButtonElement>(
              `[data-decision-id="${CSS.escape(returnFocus.current)}"]`,
            )
            ?.focus({ preventScroll: true });
      });
    };
    if (selected)
      void api.intelligence
        .history(selected.id)
        .then((value) => {
          if (current) setHistory(value);
        })
        .catch((error) => {
          if (current) setError(error.message);
        })
        .finally(() => {
          if (current) setHistoryLoading(false);
        });
    return () => {
      current = false;
    };
  }, [selected?.id, selected?.revision]);
  const open = (item: IntelligenceDecision) => {
    returnFocus.current = item.id;
    setSelected(item);
  };
  const visible = items.filter(
    (item) =>
      filter === "all" ||
      (filter === "attention"
        ? !["active", "closed"].includes(item.reviewState)
        : !item.closed),
  );
  const attention = items.filter(
    (item) => !["active", "closed"].includes(item.reviewState),
  ).length;
  const back = () => {
    setSelected(null);
    requestAnimationFrame(() => {
      if (returnFocus.current)
        document
          .querySelector<HTMLButtonElement>(
            `[data-decision-id="${CSS.escape(returnFocus.current)}"]`,
          )
          ?.focus({ preventScroll: true });
    });
  };
  if (selected)
    return (
      <section className="card decision-detail">
        <div className="row between">
          <button className="btn ghost small" onClick={back}>
            <ArrowLeft size={13} /> All decisions
          </button>
          <span className={`intel-state ${selected.reviewState}`}>
            {selected.reviewState.replaceAll("_", " ")}
          </span>
        </div>
        <div className="decision-heading">
          <h2>{selected.title}</h2>
          <p className="mono">
            {selected.cve}
            {selected.packageName
              ? ` · ${selected.packageName}@${selected.packageVersion}`
              : ""}
          </p>
          <p>
            <strong>{DECISION_LABELS[selected.verdict]}</strong> · Review{" "}
            {selected.reviewAt} · Revision {selected.revision}
          </p>
        </div>
        <p className="decision-note decision-rationale">{selected.note}</p>
        <p className="field-help">
          This local decision does not update Checkmarx or certify that a fix is
          effective.
        </p>
        {selected.reviewReasons.map((reason) => (
          <Banner key={reason} kind="warn">
            {reason}
          </Banner>
        ))}
        <dl className="kv">
          <dt>Recorded assumptions</dt>
          <dd>
            {selected.assumptions.notInKev && <p>Not listed in CISA KEV</p>}
            {selected.assumptions.epssBelow != null && (
              <p>
                EPSS below {(selected.assumptions.epssBelow * 100).toFixed(2)}%
              </p>
            )}
            {selected.assumptions.manual && (
              <p className="decision-note">
                Manual: {selected.assumptions.manual}
              </p>
            )}
            {!selected.assumptions.notInKev &&
              selected.assumptions.epssBelow == null &&
              !selected.assumptions.manual &&
              "No additional assumptions recorded."}
          </dd>
        </dl>
        <IntelligenceRefresh cves={[selected.cve]} onComplete={load} />
        <details>
          <summary>Evidence pinned at revision {selected.revision}</summary>
          <IntelligenceFacts snapshot={selected.evidence} historical />
        </details>
        <details>
          <summary>Current intelligence</summary>
          <IntelligenceFacts snapshot={selected.currentEvidence} />
        </details>
        <details>
          <summary>
            {historyLoading
              ? "Loading decision history…"
              : `Decision history (${history.length} ${history.length === 1 ? "revision" : "revisions"})`}
          </summary>
          {history.map((item) => (
            <article className="decision-revision" key={item.revision}>
              <strong>
                Revision {item.revision} ·{" "}
                {item.closed ? "Closed" : DECISION_LABELS[item.verdict]}
              </strong>
              <p className="faint">
                {new Date(item.updatedAt).toLocaleString()} · Review{" "}
                {item.reviewAt}
              </p>
              <p className="decision-note">{item.closeReason ?? item.note}</p>
              {item.reviewAlert && (
                <>
                  <p className="field-help">
                    Review triggered{" "}
                    {new Date(item.reviewAlert.at).toLocaleString()}:{" "}
                    {item.reviewAlert.reasons.join(" · ")}
                  </p>
                  <details>
                    <summary>Evidence that prompted review</summary>
                    <IntelligenceFacts
                      snapshot={item.reviewAlert.evidence}
                      historical
                    />
                  </details>
                </>
              )}
              <details>
                <summary>Pinned source evidence</summary>
                <IntelligenceFacts snapshot={item.evidence} historical />
              </details>
            </article>
          ))}
        </details>
        {!selected.closed && (
          <>
            <button
              className="btn small"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Record a revised decision
            </button>
            <div className="intel-close">
              <label className="field">
                Reason for closing
                <textarea
                  aria-label="Decision closure reason"
                  rows={2}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <button
                className="btn ghost small"
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void run(() =>
                    api.intelligence.closeDecision({
                      id: selected.id,
                      expectedRevision: selected.revision,
                      reason,
                    }),
                  )
                }
              >
                Close local decision
              </button>
            </div>
          </>
        )}
        {editing && (
          <DecisionDialog
            finding={{
              id: selected.findingId,
              scanId: selected.scanId,
              title: selected.title,
            }}
            snapshot={selected.currentEvidence}
            existing={selected}
            onClose={() => {
              setEditing(false);
              load();
            }}
          />
        )}
        {error && <Banner kind="error">{error}</Banner>}
      </section>
    );
  return (
    <>
      <div className="decision-overview">
        <div>
          <h2>Decision reviews</h2>
          <p className="field-help">
            Keep the rationale. Revisit it when the evidence changes.
          </p>
        </div>
        {!loading && (
          <div className="decision-counts">
            <span>
              <strong>{items.filter((item) => !item.closed).length}</strong>{" "}
              open
            </span>
            <span className={attention ? "attention" : ""}>
              <strong>{attention}</strong> to revisit
            </span>
          </div>
        )}
      </div>
      <div className="toolbar">
        <select
          aria-label="Decision review filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="open">Open decisions</option>
          <option value="attention">Needs review</option>
          <option value="all">All decisions</option>
        </select>
        <button className="btn ghost small" onClick={load}>
          {loading ? <Spinner size={13} /> : <RefreshCw size={13} />}
          Recheck cached evidence
        </button>
        <button
          className="btn small"
          disabled={busy || !items.length}
          onClick={() => void run(() => api.intelligence.exportDecisions())}
        >
          <Download size={13} />
          Export decisions
        </button>
      </div>
      <p className="field-help">
        Decisions belong to the current Checkmarx connection and exact
        project/finding/package scope. Refresh intelligence to recheck
        assumptions; scanner states and verified outcomes remain separate.
      </p>
      {error && <Banner kind="error">{error}</Banner>}
      {loading ? (
        <p className="intel-loading" role="status">
          <Spinner /> Reading local decisions…
        </p>
      ) : (
        !visible.length && (
          <Empty
            icon={
              items.length ? (
                <Search size={30} strokeWidth={1.5} />
              ) : (
                <ClipboardCheck size={34} strokeWidth={1.4} />
              )
            }
            title={
              items.length
                ? "No decisions in this view"
                : "Record your first decision"
            }
            hint={
              items.length
                ? "Choose another filter to see your other decisions."
                : "Open a CVE finding in Results and choose Record decision. Keep the rationale, review date and evidence together."
            }
            action={
              items.length ? (
                <button className="btn small" onClick={() => setFilter("all")}>
                  Show all decisions
                </button>
              ) : (
                <button
                  className="btn small"
                  onClick={() => useApp.getState().setView("results")}
                >
                  Open Results
                </button>
              )
            }
          />
        )
      )}
      <div className="session-list">
        {visible.map((item) => (
          <button
            className="session-card"
            key={item.id}
            data-decision-id={item.id}
            onClick={() => open(item)}
          >
            <div className="row between">
              <strong>
                {item.cve} · {DECISION_LABELS[item.verdict]}
              </strong>
              <span className={`intel-state ${item.reviewState}`}>
                {item.reviewState.replaceAll("_", " ")}
              </span>
            </div>
            <p>{item.title}</p>
            <p className="faint">
              Review {item.reviewAt} · Updated{" "}
              {timeAgo(new Date(item.updatedAt).toISOString())}
            </p>
            {item.reviewReasons.map((reason) => (
              <p className="field-help" key={reason}>
                {reason}
              </p>
            ))}
          </button>
        ))}
      </div>
    </>
  );
}
