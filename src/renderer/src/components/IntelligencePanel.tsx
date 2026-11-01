import React, { useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldAlert, Star, X } from "lucide-react";
import type { Finding } from "@shared/types";
import {
  DECISION_LABELS,
  findingCVE,
  intelligenceLabel,
  intelSource,
  type DecisionVerdict,
  type IntelligenceDecision,
  type IntelligenceSnapshot,
} from "@shared/intelligence";
import { api } from "../api";
import { useApp } from "../store";
import { Banner, Spinner, timeAgo } from "./ui";

export function notifyIntelligence() {
  window.dispatchEvent(new Event("marx-intelligence-changed"));
}
export function useIntelligence(cves: string[]) {
  const [snapshots, setSnapshots] = useState<
    Record<string, IntelligenceSnapshot>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(cves.length > 0);
  const [version, setVersion] = useState(0);
  const key = [...new Set(cves)].sort().join(",");
  useEffect(() => {
    const update = () => setVersion((value) => value + 1);
    window.addEventListener("marx-intelligence-changed", update);
    return () =>
      window.removeEventListener("marx-intelligence-changed", update);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setVersion((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let current = true;
    setError(null);
    setLoading(!!key);
    if (!key) {
      setSnapshots({});
      return;
    }
    void (async () => {
      const ids = key.split(",");
      const data: Record<string, IntelligenceSnapshot> = {};
      for (let start = 0; start < ids.length && current; start += 5000)
        Object.assign(
          data,
          await api.intelligence.get(ids.slice(start, start + 5000)),
        );
      if (current) setSnapshots(data);
    })()
      .catch((error) => {
        if (current) setError(error.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [key, version]);
  return { snapshots, error, loading };
}

export function IntelligenceRefresh({
  cves,
  onComplete,
}: {
  cves: string[];
  onComplete?: () => void;
}) {
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef<{ requestId: string; canceled: boolean } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const active = run.current;
      if (active) {
        active.canceled = true;
        void api.intelligence.cancel(active.requestId).catch(() => undefined);
      }
    };
  }, []);
  const refresh = async () => {
    if (run.current) return;
    const ids = [...new Set(cves)];
    if (!ids.length) return;
    if (ids.length > 5000) {
      setError(
        "Refresh at most 5,000 CVEs at a time. Narrow the findings selection.",
      );
      return;
    }
    const active = { requestId: crypto.randomUUID(), canceled: false };
    run.current = active;
    const deadline = setTimeout(() => {
      active.canceled = true;
      void api.intelligence.cancel(active.requestId).catch(() => undefined);
      if (mounted.current)
        setError(
          "The ten-minute refresh budget expired. Completed observations remain cached.",
        );
    }, 600000);
    setError(null);
    setProgress({ done: 0, total: ids.length });
    try {
      for (let index = 0; index < ids.length; index += 20) {
        if (active.canceled) break;
        active.requestId = crypto.randomUUID();
        await api.intelligence.refresh({
          cves: ids.slice(index, index + 20),
          requestId: active.requestId,
          force: true,
          reuseCatalog: index > 0,
        });
        notifyIntelligence();
        if (mounted.current)
          setProgress({
            done: Math.min(index + 20, ids.length),
            total: ids.length,
          });
      }
      if (mounted.current) onComplete?.();
    } catch (error) {
      if (mounted.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(deadline);
      run.current = null;
      if (mounted.current) setProgress(null);
      notifyIntelligence();
    }
  };
  return (
    <div className="intel-refresh">
      <div className="row">
        <button
          className="btn small"
          disabled={!cves.length || !!progress}
          onClick={() => void refresh()}
        >
          <RefreshCw size={13} className={progress ? "spin" : ""} />
          {progress
            ? `${progress.done} / ${progress.total} CVEs`
            : `Refresh intelligence${cves.length > 1 ? ` · ${new Set(cves).size} CVEs` : ""}`}
        </button>
        {progress && (
          <button
            className="btn ghost small"
            onClick={() => {
              const active = run.current;
              if (active) {
                active.canceled = true;
                void api.intelligence
                  .cancel(active.requestId)
                  .catch((error) => setError(error.message));
              }
            }}
          >
            <X size={13} />
            Cancel
          </button>
        )}
      </div>
      {error && <Banner kind="warn">{error}</Banner>}
    </div>
  );
}

export function IntelligenceFacts({
  snapshot,
  scannerScore,
  historical = false,
}: {
  snapshot?: IntelligenceSnapshot;
  scannerScore?: number;
  historical?: boolean;
}) {
  if (!snapshot)
    return (
      <p className="field-help">
        No cached intelligence. Enable sources in Settings, then refresh
        explicitly.
      </p>
    );
  const kev = intelSource(snapshot, "kev"),
    epss = intelSource(snapshot, "epss"),
    cve = intelSource(snapshot, "cve");
  const differing = cve?.value?.scores?.some(
    (score) =>
      scannerScore != null && Math.abs(score.score - scannerScore) >= 2,
  );
  return (
    <div className="intel-facts">
      {snapshot.synthetic && (
        <Banner kind="info">
          Synthetic intelligence fixture · no live provider data.
        </Banner>
      )}
      <div className="intel-headline">
        <ShieldAlert size={16} />
        <strong>{intelligenceLabel(snapshot)}</strong>
        {kev?.value?.listed && epss?.state === "fresh" && epss.value?.probability != null && (
          <span className="intel-signal" title="Published 30-day exploitation probability, not proof of local exposure">EPSS {(epss.value.probability * 100).toFixed(2)}%</span>
        )}
      </div>
      <p className="field-help">
        {historical
          ? "Source states below describe the pinned observation at capture time. They have not been refreshed."
          : "External context is separate from scanner severity and does not establish reachability or a verified fix."}
      </p>
      {differing && (
        <Banner kind="warn">
          Published CVSS scores differ from Checkmarx. Review the scorer and
          version before comparing them.
        </Banner>
      )}
      {cve?.value?.recordState === "REJECTED" && (
        <Banner kind="warn">
          The CVE record is rejected. Review the finding's identity and
          applicability.
        </Banner>
      )}
      {snapshot.sources.map((source) => (
        <section className="intel-source" key={source.source}>
          <div className="row between">
            <strong>
              {
                { kev: "CISA KEV", epss: "FIRST EPSS", cve: "CVE.org" }[
                  source.source
                ]
              }
            </strong>
            <span className={`intel-state ${source.state}`}>
              {source.state.replace("_", " ")}
            </span>
          </div>
          {source.error && (
            <p className="field-help warn-text">{source.error}</p>
          )}
          {source.fetchedAt && (
            <p className="faint">
              Fetched {timeAgo(new Date(source.fetchedAt).toISOString())}
              {source.state === "stale" ? " · retained observation" : ""}
            </p>
          )}
          {source.source === "kev" && source.value?.listed != null && (
            <>
              <p>
                {source.value.listed
                  ? "Listed as known exploited"
                  : "Not listed in the fetched catalog"}
              </p>
              {source.value.listed && (
                <>
                  <p className="field-help">
                    Added {source.value.dateAdded} · Ransomware use:{" "}
                    {source.value.ransomware === "Known"
                      ? "documented"
                      : "not documented"}
                  </p>
                  <p className="field-help">{source.value.action}</p>
                  <p className="faint">
                    CISA catalog due date: {source.value.dueDate}. Your
                    organization's remediation policy determines your deadline.
                  </p>
                </>
              )}
            </>
          )}
          {source.source === "epss" && source.value?.probability != null && (
            <>
              <p className="intel-number">
                {(source.value.probability * 100).toFixed(2)}%{" "}
                <span>30-day exploitation probability</span>
              </p>
              <p className="field-help">
                Percentile: {((source.value.percentile ?? 0) * 100).toFixed(2)}{" "}
                · Score date: {source.value.date}. This is a population
                estimate, not proof of local exposure.
              </p>
            </>
          )}
          {source.source === "cve" && source.value && (
            <>
              <p>{source.value.title || source.value.recordState}</p>
              {source.value.scores?.map((score, index) => (
                <p className="field-help" key={index}>
                  {score.provider} · CVSS {score.version}:{" "}
                  <strong>{score.score}</strong>
                  <br />
                  <span className="mono intel-vector">{score.vector}</span>
                </p>
              ))}
              {source.value.ssvc?.map((ssvc, index) => (
                <div className="field-help" key={index}>
                  <strong>{ssvc.provider} published SSVC context</strong>
                  <p>
                    {ssvc.role} ·{" "}
                    {ssvc.options
                      .map((option) => `${option.name}: ${option.value}`)
                      .join(" · ")}
                  </p>
                  <p className="faint">
                    Published context is not an organization-specific decision.
                  </p>
                </div>
              ))}
            </>
          )}
          {!source.value && (
            <p className="field-help">
              {source.state === "disabled"
                ? "Source is disabled. Enable it in Settings to allow requests."
                : "No usable observation. Unknown is not a zero score or evidence of safety."}
            </p>
          )}
        </section>
      ))}
      {!!cve?.value?.references?.length && (
        <details className="intel-references">
          <summary>
            References and exploit evidence ({cve.value.references.length})
          </summary>
          <p className="field-help">
            CVE record tags describe these links. They are not independently
            validated exploits; Marx never downloads or executes them.
          </p>
          {cve.value.references.map((reference) => (
            <p key={reference.url}>
              <span className="intel-state">{reference.kind}</span>{" "}
              <a
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  void api.shell.openExternal(reference.url);
                }}
              >
                {reference.title || new URL(reference.url).hostname}
              </a>
              <small className="faint"> · {reference.provider}</small>
            </p>
          ))}
        </details>
      )}
      <div className="row intel-links">
        <a
          href="#"
          onClick={(event) => {
            event.preventDefault();
            void api.shell.openExternal(
              `https://www.cve.org/CVERecord?id=${snapshot.cve}`,
            );
          }}
        >
          CVE record ↗
        </a>
        <a
          href="#"
          onClick={(event) => {
            event.preventDefault();
            void api.shell.openExternal("https://www.first.org/epss/");
          }}
        >
          About EPSS ↗
        </a>
      </div>
    </div>
  );
}

export function FindingIntelligence({
  finding,
  readOnly = false,
}: {
  finding: Finding;
  readOnly?: boolean;
}) {
  const cve = findingCVE(finding.cve);
  const { snapshots, error } = useIntelligence(cve && !readOnly ? [cve] : []);
  const [notice, setNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState(false);
  if (!cve) return null;
  return (
    <details className="intel-panel">
      <summary>
        CVE intelligence · <span className="mono">{cve}</span> ·{" "}
        {intelligenceLabel(snapshots[cve])}
      </summary>
      {error && <Banner kind="warn">{error}</Banner>}
      {notice && (
        <p role="status" className="field-help">
          {notice}
        </p>
      )}
      {readOnly ? (
        <p className="field-help">
          Demo mode does not make intelligence requests or save decisions.
        </p>
      ) : (
        <div className="intel-actions">
          <IntelligenceRefresh cves={[cve]} />
          <button
            className="btn ghost small"
            onClick={() =>
              void api.intelligence
                .watch(cve)
                .then(() => {
                  setNotice("Added to the local watchlist.");
                  notifyIntelligence();
                })
                .catch((error) => setNotice(error.message))
            }
          >
            <Star size={13} />
            Watch CVE
          </button>
          <button className="btn ghost small" onClick={() => setDecision(true)}>
            Record decision
          </button>
        </div>
      )}
      <IntelligenceFacts
        snapshot={readOnly ? undefined : snapshots[cve]}
        scannerScore={finding.cvssScore}
      />
      {decision && (
        <DecisionDialog
          finding={finding}
          snapshot={snapshots[cve]}
          onClose={() => setDecision(false)}
        />
      )}
    </details>
  );
}

export function DecisionDialog({
  finding,
  snapshot,
  onClose,
  existing,
}: {
  finding: Pick<Finding, "id" | "scanId" | "title" | "connectionId">;
  snapshot?: IntelligenceSnapshot;
  onClose: () => void;
  existing?: IntelligenceDecision;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [verdict, setVerdict] = useState<DecisionVerdict>(
    existing?.verdict ?? "defer",
  );
  const [note, setNote] = useState(existing?.note ?? "");
  const [reviewAt, setReviewAt] = useState(
    existing?.reviewAt ??
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );
  const [manual, setManual] = useState(existing?.assumptions.manual ?? "");
  const [notInKev, setNotInKev] = useState(false),
    [below, setBelow] = useState(false),
    [threshold, setThreshold] = useState("10");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<IntelligenceDecision | undefined>(
    existing,
  );
  useEffect(() => {
    let mounted = true;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    if (!existing)
      void api.intelligence
        .decisions()
        .then((items) => {
          if (mounted)
            setCurrent(
              items.find(
                (item) =>
                  item.findingId === finding.id &&
                  item.scanId === finding.scanId,
              ),
            );
        })
        .catch((error) => {
          if (mounted) setError(error.message);
        });
    return () => {
      mounted = false;
      element?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const kev = intelSource(snapshot, "kev"),
    epss = intelSource(snapshot, "epss");
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.intelligence.decide({
        connectionId:
          existing?.connectionId ??
          finding.connectionId ??
          useApp.getState().connectionId ??
          "",
        scanId: finding.scanId,
        findingId: finding.id,
        expectedRevision: current?.revision ?? 0,
        verdict,
        note,
        reviewAt,
        assumptions: {
          manual,
          ...(notInKev ? { notInKev: true } : {}),
          ...(below ? { epssBelow: Number(threshold) / 100 } : {}),
        },
      });
      notifyIntelligence();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="decision-dialog"
      aria-labelledby="decision-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="row between">
        <h2 id="decision-title">Record a local decision</h2>
        <button
          className="btn ghost small icon"
          aria-label="Close decision"
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <p>{finding.title}</p>
      <p className="field-help">
        This records your assessment. It does not change Checkmarx's result
        state or verify a fix.
      </p>
      {error && <Banner kind="error">{error}</Banner>}
      <label className="field">
        Decision
        <select
          aria-label="Decision"
          value={verdict}
          onChange={(event) =>
            setVerdict(event.target.value as DecisionVerdict)
          }
        >
          {Object.entries(DECISION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Rationale
        <textarea
          aria-label="Decision rationale"
          value={note}
          maxLength={2000}
          rows={4}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <label className="field">
        Review date
        <input
          aria-label="Decision review date"
          type="date"
          required
          value={reviewAt}
          onChange={(event) => setReviewAt(event.target.value)}
        />
      </label>
      <fieldset>
        <legend>Evidence assumptions to recheck</legend>
        <label className="check">
          <input
            type="checkbox"
            disabled={kev?.state !== "fresh" || kev.value?.listed !== false}
            checked={notInKev}
            onChange={(event) => setNotInKev(event.target.checked)}
          />
          Not listed in the fresh CISA catalog
        </label>
        <label className="check">
          <input
            type="checkbox"
            disabled={
              epss?.state !== "fresh" || epss.value?.probability == null
            }
            checked={below}
            onChange={(event) => setBelow(event.target.checked)}
          />
          EPSS stays below
          <input
            aria-label="EPSS assumption threshold percent"
            className="intel-threshold"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
          %
        </label>
        <label className="field">
          Manual assumption
          <textarea
            aria-label="Manual decision assumption"
            rows={2}
            maxLength={1000}
            placeholder="For example, the affected component is not reachable from an untrusted input. This requires your own review."
            value={manual}
            onChange={(event) => setManual(event.target.value)}
          />
        </label>
      </fieldset>
      <div className="row">
        <button
          className="btn primary"
          disabled={busy || !note.trim() || !reviewAt}
          onClick={() => void save()}
        >
          {busy ? <Spinner size={14} /> : null}Save decision
        </button>
        <button className="btn ghost" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
