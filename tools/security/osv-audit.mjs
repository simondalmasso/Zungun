import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const queries = [];
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
for (const [path, entry] of Object.entries(packageLock.packages ?? {})) {
  if (!path.startsWith('node_modules/') || !entry.version) continue;
  const name = path.slice('node_modules/'.length);
  queries.push({ package: { ecosystem: 'npm', name }, version: entry.version });
}
for (const file of walk('android').filter((path) => path.endsWith('.lockfile'))) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const coordinate = line.split('=')[0].trim();
    const match = /^([^:]+):([^:]+):([^:]+)$/.exec(coordinate);
    if (!match) continue;
    queries.push({ package: { ecosystem: 'Maven', name: `${match[1]}:${match[2]}` }, version: match[3] });
  }
}
const unique = [...new Map(queries.map((query) => [`${query.package.ecosystem}:${query.package.name}:${query.version}`, query])).values()];
if (unique.length < 2) throw new Error('DEPENDENCY_GRAPH_NOT_RESOLVED');
const response = await fetch('https://api.osv.dev/v1/querybatch', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'user-agent': 'zungun-order076-ci' },
  body: JSON.stringify({ queries: unique }),
});
if (!response.ok) throw new Error(`OSV_QUERY_FAILED_${response.status}`);
const payload = await response.json();
const findings = [];
for (let index = 0; index < unique.length; index += 1) {
  for (const vulnerability of payload.results?.[index]?.vulns ?? []) {
    if (vulnerability.withdrawn) continue;
    findings.push({ query: unique[index], id: vulnerability.id, aliases: vulnerability.aliases ?? [] });
  }
}
mkdirSync('.artifacts/security', { recursive: true });
writeFileSync('.artifacts/security/osv-audit.json', `${JSON.stringify({
  schema: 'zungun.osv-audit.v1',
  queriedComponents: unique.length,
  findings,
}, null, 2)}\n`);
console.log(JSON.stringify({ ok: findings.length === 0, queriedComponents: unique.length, findings: findings.length }));
if (findings.length > 0) process.exitCode = 1;
