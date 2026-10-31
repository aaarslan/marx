import type { Finding } from './types';
import type { RemediationGroup } from './workbench';
import { SEVERITY_ORDER } from './severity';

function groupKey(finding: Finding, index: number): string {
  const scope = [finding.connectionId ?? '', finding.projectId, finding.type];
  if (finding.type === 'sca' && finding.packageName && finding.packageVersion && finding.packageManager) {
    const paths = finding.dependencyPaths?.map((path) => JSON.stringify(path.map((node) => [node.name ?? '', node.version ?? '', node.packageManager ?? '', node.id ?? '', (node.locations ?? []).map((location) => location.path).sort()]))).sort() ?? [];
    const manifests = [...new Set(finding.flow.map((node) => node.fileName).filter(Boolean))].sort();
    if (paths.length || manifests.length) return JSON.stringify([...scope, finding.packageManager.toLowerCase(), finding.packageName, finding.packageVersion, finding.isDirectDependency ?? 'unknown', paths, manifests]);
  }
  if (finding.type === 'sast') {
    const sink = finding.flow.at(-1);
    if (finding.flow.length > 1 && sink?.fileName && sink.line > 0 && finding.title !== 'SAST finding') {
      return JSON.stringify([...scope, finding.title, finding.language ?? '', finding.cwe ?? '', sink.fileName, sink.line, sink.column ?? null, sink.fullName ?? sink.name ?? '', sink.method ?? '']);
    }
  }
  return JSON.stringify([...scope, 'individual', finding.id, index]);
}

export function groupFindings(findings: Finding[]): RemediationGroup[] {
  const groups = new Map<string, Finding[]>();
  for (const [index, finding] of findings.entries()) {
    const key = groupKey(finding, index);
    const existing = groups.get(key);
    if (existing) existing.push(finding);
    else groups.set(key, [finding]);
  }
  return [...groups.entries()].map(([key, members]) => {
    const first = members[0];
    const severity = members.reduce((highest, finding) => SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[highest] ? finding.severity : highest, first.severity);
    const redundancyHints = members.filter((finding) => finding.redundancy === 'redundant').length;
    const hint = redundancyHints ? ` Checkmarx marks ${redundancyHints} as redundant; this is a prioritization hint, not proof that a change resolves them.` : '';
    const title = first.type === 'sca' && first.packageName
      ? `${first.packageName}${first.packageVersion ? `@${first.packageVersion}` : ''}`
      : first.title;
    const rationale = members.length === 1
      ? `Individual finding; no other finding shares enough recorded remediation context.${hint}`
      : first.type === 'sca'
        ? 'Same package, version, manager and recorded dependency context. Review the parent dependency and advisory guidance before choosing a shared upgrade.'
        : `Same SAST rule and recorded sink location. Inspect every source-to-sink flow before choosing a shared change.${hint}`;
    return { id: `group:${key}`, title, rationale, findingIds: members.map((finding) => finding.id), severity, type: first.type };
  }).sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || b.findingIds.length - a.findingIds.length || a.title.localeCompare(b.title));
}
