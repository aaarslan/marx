import type { Finding, ResultsPage, ScanOptions, Severity } from './types';
import type { ScanComparison, ScanProvenance } from './workbench';
import { SEVERITY_ORDER } from './severity';
import { computeVerdict } from './verdict';

const present = (value: string | undefined): value is string => Boolean(value?.trim() && value !== 'undefined' && value !== 'null');

function identity(finding: Finding): string | null {
  const scanner = finding.type.toLowerCase();
  if (scanner === 'sca') {
    if (![finding.packageManager, finding.packageName, finding.packageVersion, finding.cve].every(present)) return null;
    return JSON.stringify([scanner, finding.packageManager!.toLowerCase(), finding.packageName, finding.packageVersion, finding.cve]);
  }
  if ((scanner === 'sast' || scanner === 'kics') && present(finding.similarityId)) {
    return JSON.stringify([scanner, finding.similarityId]);
  }
  return null;
}

function byIdentity(findings: Finding[]): Map<string, Finding[]> {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = identity(finding);
    if (!key) continue;
    const existing = grouped.get(key);
    if (existing) existing.push(finding);
    else grouped.set(key, [finding]);
  }
  return grouped;
}

function duplicateIds(findings: Finding[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const finding of findings) {
    if (seen.has(finding.id)) duplicates.add(finding.id);
    seen.add(finding.id);
  }
  return duplicates;
}

function requestedConfig(options: ScanOptions): string {
  return JSON.stringify({
    scanners: [...options.scanners].sort(),
    sastPreset: options.sastPreset,
    sastIncremental: options.sastIncremental,
    sastBaseBranch: options.sastBaseBranch ?? '',
    scaExploitablePath: options.scaExploitablePath,
    excludes: [...options.excludes].sort()
  });
}

function scanners(values: string[] | undefined): string | null {
  return values?.length ? [...new Set(values.map((value) => value.trim().toLowerCase()))].sort().join(',') : null;
}

function provenanceFor(page: ResultsPage): ScanProvenance | undefined {
  return page.provenance ?? page.scan?.provenance;
}

function connectionFor(page: ResultsPage): string | undefined {
  return page.connectionId ?? provenanceFor(page)?.connectionId ?? page.scan?.connectionId;
}

function complete(page: ResultsPage): boolean {
  if (page.scan?.status !== 'Completed' || page.truncated || page.totalCount !== page.findings.length) return false;
  const counts = page.counts;
  return !counts || (counts.reported === counts.received && counts.received === counts.normalized && counts.normalized === page.findings.length && counts.unsupported === 0);
}

export function compareScans(baseline: ResultsPage, current: ResultsPage): ScanComparison {
  const reasons: string[] = [];
  const incompatibleReasons: string[] = [];
  let differentScope = false;
  const flag = (message: string, incompatible = false) => {
    if (!reasons.includes(message)) reasons.push(message);
    if (incompatible) incompatibleReasons.push(message);
  };
  const beforeConnection = connectionFor(baseline);
  const afterConnection = connectionFor(current);
  if (!present(beforeConnection) || !present(afterConnection)) flag('Connection identity is missing from one or both scans.');
  else if (beforeConnection !== afterConnection) {
    differentScope = true;
    flag('The scans belong to different Checkmarx connections.', true);
  }
  const beforeProject = baseline.scan?.projectId;
  const afterProject = current.scan?.projectId;
  if (!present(beforeProject) || !present(afterProject)) flag('Project identity is missing from one or both scans.');
  else if (beforeProject !== afterProject) {
    differentScope = true;
    flag('The scans belong to different Checkmarx projects.', true);
  }
  if (baseline.scan?.id && baseline.scan.id === current.scan?.id) {
    differentScope = true;
    flag('Choose two different scans.', true);
  }
  const beforeTime = Date.parse(baseline.scan?.createdAt ?? '');
  const afterTime = Date.parse(current.scan?.createdAt ?? '');
  if (!Number.isFinite(beforeTime) || !Number.isFinite(afterTime)) flag('Scan timestamps are missing or unrecognized.');
  else if (beforeTime >= afterTime) flag('The baseline must be older than the current scan.', true);
  if (!complete(baseline) || !complete(current)) flag('Both scans must be completed and all findings received and normalized. Missing results cannot establish absence.');

  const beforeProvenance = provenanceFor(baseline);
  const afterProvenance = provenanceFor(current);
  if (!beforeProvenance || !afterProvenance) flag('Scan provenance is missing. Recorded scan settings and source identity cannot be checked.');
  else {
    if (!present(beforeProvenance.optionsFingerprint) || !present(afterProvenance.optionsFingerprint)) flag('The recorded request configuration is incomplete.');
    if (requestedConfig(beforeProvenance.options) !== requestedConfig(afterProvenance.options)) flag('Requested scanners, presets, exclusions or scan options differ.', true);
    const requestedBefore = scanners(beforeProvenance.requestedScanners);
    const requestedAfter = scanners(afterProvenance.requestedScanners);
    const completedBefore = scanners(beforeProvenance.completedScanners);
    const completedAfter = scanners(afterProvenance.completedScanners);
    if (!requestedBefore || !requestedAfter || !completedBefore || !completedAfter) flag('Successful engine coverage is not recorded for both scans. An overall Completed status is insufficient.');
    else if (requestedBefore !== requestedAfter || completedBefore !== completedAfter || requestedBefore !== completedBefore || requestedAfter !== completedAfter) flag('The scans do not have matching requested and successfully completed engine coverage.', true);
    if (!present(beforeProvenance.effectiveConfigFingerprint) || !present(afterProvenance.effectiveConfigFingerprint)) {
      flag('Effective server configuration is unverified. Matching locally requested options do not prove equivalent scan coverage.');
    } else if (beforeProvenance.effectiveConfigFingerprint !== afterProvenance.effectiveConfigFingerprint) {
      flag('The effective server scan configurations differ. Absent findings may not have been evaluated.', true);
    }
    if (beforeProvenance.source.folderPath !== afterProvenance.source.folderPath || (beforeProvenance.source.repositoryRoot && afterProvenance.source.repositoryRoot && beforeProvenance.source.repositoryRoot !== afterProvenance.source.repositoryRoot)) {
      flag('The recorded source folders differ. A shared remote project does not establish equivalent repository scope.');
    }
    for (const [label, provenance, connection, scan] of [
      ['Baseline', beforeProvenance, beforeConnection, baseline.scan],
      ['Current', afterProvenance, afterConnection, current.scan]
    ] as const) {
      if (provenance.connectionId !== connection) flag(`${label} provenance does not match its connection identity.`, true);
      if (!present(provenance.source.fingerprint)) flag(`${label} source fingerprint is unavailable.`);
      if (!provenance.source.snapshot && provenance.sourceChanged !== false) flag(`${label} source was scanned from a live folder without a confirmed unchanged capture.`);
      if (provenance.sourceChanged) flag(`${label} source changed while the scan was running.`);
      if (scan?.branch && provenance.source.branch !== scan.branch) flag(`${label} source branch differs from its scan metadata.`, true);
    }
  }

  const oldGroups = byIdentity(baseline.findings);
  const newGroups = byIdentity(current.findings);
  const repeatedBefore = duplicateIds(baseline.findings);
  const repeatedAfter = duplicateIds(current.findings);
  if (repeatedBefore.size || repeatedAfter.size) flag('Duplicate result IDs prevent unambiguous occurrence matching.');
  if ([...baseline.findings, ...current.findings].some((finding) => finding.identityAmbiguous)) flag('Some occurrence keys only disambiguate duplicate vendor records and cannot prove equivalence between scans.');
  if (baseline.findings.some((finding) => !identity(finding)) || current.findings.some((finding) => !identity(finding))) {
    flag('Some findings lack stable scanner identities or package metadata. Titles and source locations are not used as identity.');
  }
  if ([...oldGroups.values(), ...newGroups.values()].some((group) => group.length > 1)) {
    flag('Some scanner identities describe multiple occurrences. Those families remain uncertain rather than collapsing distinct findings.');
  }
  if ([...baseline.findings, ...current.findings].some((finding) => finding.severity === 'UNKNOWN')) flag('Unknown severity values require review before a passing verdict.');
  for (const [page, connection, project] of [[baseline, beforeConnection, beforeProject], [current, afterConnection, afterProject]] as const) {
    if (page.findings.some((finding) => finding.projectId !== project || finding.scanId !== page.scan?.id || (finding.connectionId && finding.connectionId !== connection))) {
      differentScope = true;
      flag('Finding provenance does not match the enclosing scan or connection.', true);
    }
  }

  const changes: ScanComparison['changes'] = Object.create(null);
  const newBySeverity: Partial<Record<Severity, number>> = {};
  let newCount = 0;
  let persistentCount = 0;
  let escalatedCount = 0;
  let reducedCount = 0;
  let escalatedBlocking = 0;
  for (const finding of current.findings) {
    const key = identity(finding);
    const previous = key ? oldGroups.get(key) : undefined;
    const occurrences = key ? newGroups.get(key) : undefined;
    if (differentScope || !key || finding.identityAmbiguous || repeatedAfter.has(finding.id) || occurrences?.length !== 1 || (previous && (previous.length !== 1 || previous[0].identityAmbiguous || repeatedBefore.has(previous[0].id)))) {
      changes[finding.id] = 'UNCERTAIN';
    } else if (!previous && !complete(baseline)) {
      changes[finding.id] = 'UNCERTAIN';
    } else if (!previous) {
      changes[finding.id] = 'NEW';
      newBySeverity[finding.severity] = (newBySeverity[finding.severity] ?? 0) + 1;
      newCount++;
    } else if (finding.severity === 'UNKNOWN' || previous[0].severity === 'UNKNOWN') {
      changes[finding.id] = 'UNCERTAIN';
    } else if (SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[previous[0].severity]) {
      changes[finding.id] = 'ESCALATED';
      escalatedCount++;
      if (finding.severity === 'HIGH' || finding.severity === 'CRITICAL') escalatedBlocking++;
    } else if (SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[previous[0].severity]) {
      changes[finding.id] = 'REDUCED';
      reducedCount++;
    } else {
      changes[finding.id] = 'PERSISTENT';
      persistentCount++;
    }
  }
  const absent = !differentScope && complete(baseline) && complete(current)
    ? baseline.findings.filter((finding) => {
      const key = identity(finding);
      return key && !finding.identityAmbiguous && !repeatedBefore.has(finding.id) && oldGroups.get(key)?.length === 1 && !newGroups.has(key);
    })
    : [];
  const severityVerdict = computeVerdict({ newBySeverity });
  const compatibility: ScanComparison['compatibility'] = incompatibleReasons.length ? 'incompatible' : reasons.length ? 'inconclusive' : 'comparable';
  const needsAttention = severityVerdict.newCritical + severityVerdict.newHigh + escalatedBlocking;
  const verdict: ScanComparison['verdict'] = needsAttention ? 'attention' : compatibility === 'comparable' && severityVerdict.pass ? 'pass' : 'inconclusive';
  const headline = needsAttention
    ? `${needsAttention} new or escalated High/Critical finding${needsAttention === 1 ? '' : 's'} require${needsAttention === 1 ? 's' : ''} attention${compatibility === 'comparable' ? '' : '; comparison coverage is unverified'}`
    : verdict === 'inconclusive'
      ? `Comparison ${compatibility === 'incompatible' ? 'incompatible' : 'inconclusive'}; ${newCount} observed new finding${newCount === 1 ? '' : 's'}`
      : severityVerdict.headline;
  return { compatibility, reasons, changes, newBySeverity, newCount, persistentCount, escalatedCount, reducedCount, absent, verdict, headline };
}

export function verifySelectedFindings(baseline: ResultsPage, current: ResultsPage, selectedIds: string[], comparison: ScanComparison): { remainingIds: string[]; absentIds: string[] } {
  const absentCandidates = new Set(comparison.absent.map((finding) => finding.id));
  const baselineGroups = new Map<string, Finding[]>();
  for (const finding of baseline.findings) {
    const existing = baselineGroups.get(finding.id);
    if (existing) existing.push(finding);
    else baselineGroups.set(finding.id, [finding]);
  }
  const currentScaTargets = new Set(current.findings.filter((finding) => finding.type === 'sca').map((finding) => JSON.stringify([
    finding.packageManager?.toLowerCase() || null, finding.packageName || null, finding.cve?.toUpperCase() || null
  ])));
  const remainingIds: string[] = [];
  const absentIds: string[] = [];
  for (const id of new Set(selectedIds)) {
    const matches = baselineGroups.get(id);
    const target = matches?.[0];
    let absent = Boolean(complete(baseline) && complete(current) && matches?.length === 1 && target && !target.identityAmbiguous && absentCandidates.has(id));
    if (absent && target?.type === 'sca') {
      if (![target.packageManager, target.packageName, target.cve].every(present)) absent = false;
      else {
        for (const manager of [target.packageManager!.toLowerCase(), null]) {
          for (const name of [target.packageName!, null]) {
            for (const cve of [target.cve!.toUpperCase(), null]) {
              if (currentScaTargets.has(JSON.stringify([manager, name, cve]))) absent = false;
            }
          }
        }
      }
    }
    (absent ? absentIds : remainingIds).push(id);
  }
  return { remainingIds, absentIds };
}
