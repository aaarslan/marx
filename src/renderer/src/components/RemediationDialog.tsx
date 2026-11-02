import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Download, X } from 'lucide-react';
import type { Finding, Severity } from '@shared/types';
import { SEVERITIES, SEVERITY_COLOR, SEVERITY_LABEL } from '@shared/severity';
import { useIntelligence } from './IntelligencePanel';
import { findingCVE } from '@shared/intelligence';
import { createRemediationPrompts, PROMPT_CHARACTER_TARGET, REMEDIATION_TARGETS, type RemediationContext, type RemediationTarget } from '@shared/remediation';
import { api } from '../api';
import { Banner, Spinner, keepDialogFocus, restoreControlFocus } from './ui';

export interface RemediationScope {
  id: string;
  name: string;
  findings: Finding[];
}

export interface RemediationSelection {
  scopes: RemediationScope[];
  initialScope: string;
  initialSeverities: Severity[];
  context: Omit<RemediationContext, 'scope'>;
}

export function RemediationDialog({ selection, onClose, onTrack, trackLabel = 'Track remediation' }: { selection: RemediationSelection; onClose: () => void; onTrack?: (input: { findingIds: string[]; handoff: string }) => Promise<void>; trackLabel?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [scopeId, setScopeId] = useState(selection.initialScope);
  const [severities, setSeverities] = useState<Severity[]>(selection.initialSeverities);
  const [target, setTarget] = useState<RemediationTarget>('copilot');
  const [batchSize, setBatchSize] = useState(20);
  const [instructions, setInstructions] = useState('');
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'copy' | 'save' | 'track' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionLock = useRef(false);
  const scope = selection.scopes.find((item) => item.id === scopeId) ?? selection.scopes[0];
  const {snapshots: intelligence, error: intelligenceError, loading: intelligenceLoading} = useIntelligence(selection.context.demo ? [] : scope.findings.map(f=>findingCVE(f.cve)).filter((value): value is string=>!!value));
  const batches = useMemo(() => createRemediationPrompts({ findings: scope.findings, severities, target, batchSize, instructions, context: { ...selection.context, intelligence, intelligenceUnavailable:!!intelligenceError, scope: scope.name } }), [scope, severities, target, batchSize, instructions, selection, intelligence, intelligenceError]);
  const batchIndex = Math.min(index, Math.max(0, batches.length - 1));
  const batch = batches[batchIndex];
  const count = batches.reduce((total, item) => total + item.findingIds.length, 0);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => { setIndex(0); setCopied(false); setFeedback(null); setError(null); }, [scopeId, severities, target, batchSize, instructions]);
  useEffect(() => { setCopied(false); setFeedback(null); }, [batchIndex]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  const run = async (action: 'copy' | 'save' | 'track', origin: HTMLButtonElement) => {
    if (!batch || actionLock.current) return;
    actionLock.current = true;
    setBusy(action);
    setError(null);
    setFeedback(null);
    try {
      if (action === 'copy') {
        await api.remediation.copy(batch.text);
        setCopied(true);
        setFeedback(`Batch ${batchIndex + 1} copied. Paste it into your coding assistant with the repository open.`);
      } else if (action === 'save') {
        const saved = await api.remediation.save({ text: batches.map((item) => item.text).join('\n\n---\n\n'), suggestedName: `${selection.context.projectName ?? 'scan'}-remediation` });
        if (saved) setFeedback(`Saved ${batches.length} ${batches.length === 1 ? 'batch' : 'batches'} to ${saved}`);
      } else if (onTrack) {
        await onTrack({ findingIds: batches.flatMap((item) => item.findingIds), handoff: batches.map((item) => item.text).join('\n\n---\n\n') });
        setFeedback('Saved the findings and handoff in Workbench.');
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally {
      actionLock.current = false; setBusy(null);
      if (dialog.current?.open) restoreControlFocus(origin);
    }
  };

  return (
    <dialog className="remediation-dialog" ref={dialog} onKeyDown={keepDialogFocus} aria-labelledby="remediation-title" aria-describedby="remediation-description" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="remediation-heading">
        <div><div className="page-eyebrow">AI handoff</div><h2 id="remediation-title">Build a remediation prompt</h2></div>
        <button className="btn ghost small" aria-label="Close remediation prompt" onClick={onClose} autoFocus><X size={17} /></button>
      </div>
      <p id="remediation-description" className="field-help">Choose what to fix, then paste the prompt into Copilot or another coding assistant in this repository. Prompt generation stays on your computer.</p>
      <div className="remediation-options">
        <label className="field">Findings to include<select aria-label="Prompt findings scope" value={scopeId} onChange={(event) => setScopeId(event.target.value)} disabled={Boolean(busy)}>{selection.scopes.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.findings.length})</option>)}</select></label>
        <label className="field">Coding assistant<select aria-label="Coding assistant" value={target} onChange={(event) => setTarget(event.target.value as RemediationTarget)} disabled={Boolean(busy)}>{REMEDIATION_TARGETS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
      <fieldset className="remediation-severities" disabled={Boolean(busy)}>
        <legend>Severity levels</legend>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {SEVERITIES.map((severity) => <label key={severity} className={`remediation-severity ${severities.includes(severity) ? 'checked' : ''}`}>
            <input type="checkbox" aria-label={`Include ${SEVERITY_LABEL[severity]} findings`} checked={severities.includes(severity)} onChange={() => setSeverities((current) => current.includes(severity) ? current.filter((value) => value !== severity) : [...current, severity])} />
            <span className="dot" style={{ background: SEVERITY_COLOR[severity] }} />{SEVERITY_LABEL[severity]}<span className="faint">{scope.findings.filter((finding) => finding.severity === severity).length}</span>
          </label>)}
          <button className="btn ghost small" onClick={() => setSeverities([...SEVERITIES])}>All</button><button className="btn ghost small" onClick={() => setSeverities([])}>None</button>
        </div>
      </fieldset>
      <div className="remediation-options">
        <label className="field">Findings per batch<select aria-label="Findings per prompt batch" value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))} disabled={Boolean(busy)}>{[10, 20, 40].map((size) => <option value={size} key={size}>Up to {size} findings</option>)}</select><span className="field-help">Large evidence is split into additional batches without dropping findings.</span></label>
        <label className="field">Additional instructions (optional)<input type="text" aria-label="Additional remediation instructions" value={instructions} maxLength={4000} onChange={(event) => setInstructions(event.target.value)} placeholder="e.g. Keep the current Node.js version" disabled={Boolean(busy)} /></label>
      </div>
      {intelligenceLoading && <p className="field-help" role="status">Loading cached intelligence for this handoff…</p>}
      {intelligenceError && <Banner kind="warn">Cached intelligence could not be attached: {intelligenceError}. This is disclosed in the prompt.</Banner>}
      {selection.context.truncated && <Banner kind="warn">This scan is only partly loaded. The prompt includes selected loaded findings, not the entire scan.</Banner>}
      {selection.context.demo && <Banner kind="info">Demo evidence is clearly labeled in the generated prompt.</Banner>}
      <div className="remediation-preview-heading"><strong>{count} {count === 1 ? 'finding' : 'findings'} selected</strong><span className="faint">{batch ? `${batch.text.length.toLocaleString()} characters in this batch` : 'Choose at least one severity level'}</span></div>
      {batch ? <textarea className="remediation-preview" aria-label="Remediation prompt preview" readOnly spellCheck={false} value={batch.text} /> : <div className="remediation-empty" role="status">No findings match these severity levels. Choose another severity or findings scope.</div>}
      {batch && batch.text.length > PROMPT_CHARACTER_TARGET && <Banner kind="warn">One finding has unusually large evidence. Its full content is preserved; check your assistant’s input limit before pasting.</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      {feedback && <div className="remediation-feedback" role="status">{feedback}</div>}
      {onTrack && !selection.context.demo && <div className="remediation-track"><span className="field-help">Keep this evidence and handoff together, then verify the change with a fresh scan.</span><button className="btn" disabled={!batch || Boolean(busy) || intelligenceLoading} onClick={(event) => void run('track', event.currentTarget)}>{busy === 'track' ? <Spinner size={13} /> : <Check size={14} />}{trackLabel}</button></div>}
      <div className="remediation-footer">
        <div className="row"><button className="btn ghost small" aria-label="Previous prompt batch" disabled={!batch || batchIndex === 0 || Boolean(busy)} onClick={() => setIndex(batchIndex - 1)}><ChevronLeft size={15} /></button><span aria-live="polite">Batch {batches.length ? batchIndex + 1 : 0} of {batches.length}</span><button className="btn ghost small" aria-label="Next prompt batch" disabled={!batch || batchIndex >= batches.length - 1 || Boolean(busy)} onClick={() => setIndex(batchIndex + 1)}><ChevronRight size={15} /></button></div>
        <div className="row"><button className="btn" disabled={!batch || Boolean(busy) || intelligenceLoading} onClick={(event) => void run('save', event.currentTarget)}>{busy === 'save' ? <Spinner size={13} /> : <Download size={14} />}Save {batches.length > 1 ? 'all batches' : 'prompt'}</button><button className="btn primary" disabled={!batch || Boolean(busy) || intelligenceLoading} onClick={(event) => void run('copy', event.currentTarget)}>{busy === 'copy' ? <Spinner size={13} /> : copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : batches.length > 1 ? 'Copy this batch' : 'Copy prompt'}</button></div>
      </div>
    </dialog>
  );
}
