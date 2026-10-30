import type { Finding, ResultsPage } from '@shared/types';

const now = new Date().toISOString();

function sast(
  i: number,
  query: string,
  group: string,
  lang: string,
  severity: Finding['severity'],
  state: Finding['state'],
  file: string,
  nodes: { file: string; line: number; name: string }[]
): Finding {
  return {
    id: String(1000 + i),
    scanId: 'demo-scan',
    projectId: 'demo-project',
    type: 'sast',
    label: 'sast',
    similarityId: `demo-sim-${i}`,
    severity,
    state,
    status: i % 3 === 0 ? 'RECURRENT' : 'NEW',
    created: now,
    title: query,
    where: `${file}:${nodes[0].line}`,
    language: lang,
    group,
    cwe: String(79 + (i % 5)),
    description:
      'The application receives user-controlled input and incorporates it into an HTML page ' +
      'without proper validation or escaping, allowing an attacker to inject arbitrary scripts ' +
      'that execute in the context of other users.\n\nRemediation: encode the data before ' +
      'rendering it, or use the framework\u2019s built-in escaping.',
    compliances: ['OWASP Top 10 2021 A03', 'PCI DSS v3.2.1 6.5.7'],
    flow: nodes.map((n) => ({ fileName: n.file, line: n.line, name: n.name }))
  };
}

function sca(
  i: number,
  cve: string,
  pkg: string,
  version: string,
  severity: Finding['severity'],
  cvss: number,
  state: Finding['state'],
  direct: boolean
): Finding {
  return {
    id: cve,
    scanId: 'demo-scan',
    projectId: 'demo-project',
    type: 'sca',
    label: 'sca',
    similarityId: `demo-sca-${i}`,
    severity,
    state,
    status: 'NEW',
    created: now,
    title: `${cve} · ${pkg}@${version}`,
    where: 'package.json',
    cve,
    cwe: 'CWE-79',
    cvssScore: cvss,
    description:
      `A vulnerability was found in ${pkg} ${version}. Upgrade to a patched version to resolve this issue.`,
    compliances: [],
    flow: [{ fileName: 'package.json', line: 12 }],
    packageName: pkg,
    packageVersion: version,
    recommendedVersion: '4.17.21',
    isDirectDependency: direct
  };
}

export const DEMO_RESULTS: ResultsPage = {
  totalCount: 9,
  findings: [
    sast(1, 'Stored_XSS', 'JavaScript_High_Risk', 'JavaScript', 'CRITICAL', 'TO_VERIFY', 'src/components/Search.jsx', [
      { file: 'src/components/Search.jsx', line: 42, name: 'req.body.q' },
      { file: 'src/store/search.js', line: 18, name: 'setQuery(q)' },
      { file: 'src/components/Search.jsx', line: 87, name: 'innerHTML' }
    ]),
    sast(2, 'SQL_Injection', 'Java_High_Risk', 'Java', 'HIGH', 'TO_VERIFY', 'src/main/java/api/UserRepo.java', [
      { file: 'src/main/java/api/UserServlet.java', line: 55, name: 'request.getParameter("id")' },
      { file: 'src/main/java/api/UserRepo.java', line: 31, name: 'Statement.execute' }
    ]),
    sca(3, 'CVE-2021-23337', 'lodash', '4.17.20', 'HIGH', 7.2, 'TO_VERIFY', true),
    sast(4, 'Reflected_XSS', 'JavaScript_High_Risk', 'JavaScript', 'HIGH', 'CONFIRMED', 'src/routes/product.jsx', [
      { file: 'src/routes/product.jsx', line: 12, name: 'params.filter' },
      { file: 'src/routes/product.jsx', line: 40, name: 'dangerouslySetInnerHTML' }
    ]),
    sca(5, 'CVE-2022-0235', 'node-fetch', '2.6.6', 'MEDIUM', 5.3, 'TO_VERIFY', false),
    sast(6, 'Open_Redirect', 'JavaScript_Medium_Risk', 'JavaScript', 'MEDIUM', 'TO_VERIFY', 'src/auth/callback.js', [
      { file: 'src/auth/callback.js', line: 8, name: 'query.redirectTo' },
      { file: 'src/auth/callback.js', line: 22, name: 'res.redirect' }
    ]),
    sast(7, 'Log_Forcing', 'JavaScript_Low_Risk', 'JavaScript', 'LOW', 'NOT_EXPLOITABLE', 'src/logger.js', [
      { file: 'src/logger.js', line: 15, name: 'user.displayName' },
      { file: 'src/logger.js', line: 33, name: 'console.info' }
    ]),
    sca(8, 'CVE-2020-28469', 'elliptic', '6.5.3', 'LOW', 3.7, 'PROPOSED_NOT_EXPLOITABLE', false),
    sast(9, 'Info_Log_PII', 'JavaScript_Info', 'JavaScript', 'INFO', 'TO_VERIFY', 'src/logger.js', [
      { file: 'src/logger.js', line: 40, name: 'user.email' }
    ])
  ]
};
