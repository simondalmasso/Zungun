import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const out = '.artifacts/security';
mkdirSync(out, { recursive: true });
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});

const npmLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const npmComponents = Object.entries(npmLock.packages ?? {}).flatMap(([path, entry]) => {
  if (!path.startsWith('node_modules/') || !entry.version) return [];
  return [{
    type: 'library',
    ecosystem: 'npm',
    name: path.slice('node_modules/'.length),
    version: entry.version,
    license: entry.license ?? 'UNKNOWN',
    integrity: entry.integrity ?? null,
    resolved: entry.resolved ?? null,
  }];
});

const gradleLockFiles = walk('android').filter((path) => path.endsWith('.lockfile')).sort();
if (gradleLockFiles.length === 0) throw new Error('GRADLE_DEPENDENCY_LOCKS_MISSING');
const gradleCoordinates = new Set();
for (const file of gradleLockFiles) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const coordinate = line.split('=')[0].trim();
    if (/^[^:]+:[^:]+:[^:]+$/.test(coordinate)) gradleCoordinates.add(coordinate);
  }
}
if (gradleCoordinates.size === 0) throw new Error('GRADLE_GRAPH_EMPTY');

const licenseRules = [
  [/^(androidx\.|com\.android\.|com\.google\.|org\.jetbrains\.|org\.jetbrains\.kotlin)/, 'Apache-2.0'],
  [/^junit:junit:/, 'EPL-1.0'],
  [/^org\.hamcrest:/, 'BSD-3-Clause'],
  [/^org\.ow2\.asm:/, 'BSD-3-Clause'],
  [/^org\.checkerframework:/, 'MIT'],
  [/^com\.squareup:/, 'Apache-2.0'],
  [/^com\.google\.code\.findbugs:/, 'Apache-2.0'],
];
const gradleComponents = [...gradleCoordinates].sort().map((coordinate) => {
  const [group, name, version] = coordinate.split(':');
  const license = licenseRules.find(([pattern]) => pattern.test(coordinate))?.[1] ?? 'UNKNOWN';
  return { type: 'library', ecosystem: 'Maven', group, name, version, license, coordinate };
});
const unknownLicenses = [...npmComponents, ...gradleComponents].filter((component) => component.license === 'UNKNOWN');
if (unknownLicenses.length > 0) throw new Error(`UNKNOWN_LICENSES:${unknownLicenses.map((item) => item.name).join(',')}`);

const verificationMetadata = 'android/gradle/verification-metadata.xml';
const verificationBytes = readFileSync(verificationMetadata);
if (!verificationBytes.includes(Buffer.from('sha256'))) throw new Error('GRADLE_VERIFICATION_METADATA_INCOMPLETE');

const components = [
  { type: 'application', ecosystem: 'internal', name: 'zungun', version: npmLock.version, license: 'Apache-2.0' },
  ...npmComponents,
  ...gradleComponents,
];
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
const serial = sha256(JSON.stringify(components.map((item) => [item.ecosystem, item.name, item.version]))).slice(0, 32);
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${serial}`,
  version: 1,
  metadata: { component: { name: 'Zungun', version: npmLock.version, type: 'application' } },
  components: components.map((component) => ({
    type: component.type,
    name: component.name,
    version: component.version,
    group: component.group,
    licenses: [{ license: { id: component.license } }],
    purl: component.ecosystem === 'npm'
      ? `pkg:npm/${encodeURIComponent(component.name)}@${component.version}`
      : component.ecosystem === 'Maven'
        ? `pkg:maven/${component.group}/${component.name}@${component.version}`
        : undefined,
  })),
};
writeFileSync(`${out}/sbom.cdx.json`, `${JSON.stringify(sbom, null, 2)}\n`);
writeFileSync(`${out}/licenses.json`, `${JSON.stringify({
  schema: 'zungun.licenses.v2',
  policy: { unknownDenied: true, componentCount: components.length },
  components: components.map(({ ecosystem, name, version, license }) => ({ ecosystem, name, version, license })),
}, null, 2)}\n`);
const provenance = {
  schema: 'zungun.provenance.v2',
  orderId: 'ZUNGUN-AUD-ARQ-FULL-PROJECT-CORRECTIVE-COMPLETION-076',
  sourceCommit,
  sourceTree,
  baseCommit: '8b206b91fb98bc3d514f9709b6258dcb839ad5f1',
  protectedOracleReference: '13d6745217672da16985d815c427aa4c953de227',
  trackedFiles: tracked.length,
  npmLockSha256: sha256(readFileSync('package-lock.json')),
  gradleLockFiles: gradleLockFiles.map((file) => ({ file, sha256: sha256(readFileSync(file)) })),
  gradleVerificationMetadataSha256: sha256(verificationBytes),
  githubRunId: process.env.GITHUB_RUN_ID ?? null,
  githubWorkflowSha: process.env.GITHUB_WORKFLOW_SHA ?? null,
};
writeFileSync(`${out}/provenance.json`, `${JSON.stringify(provenance, null, 2)}\n`);

const textFiles = tracked.filter((file) => !/(?:\.jar|\.aar|\.apk|\.png|\.jpg|\.zip)$/.test(file));
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{30,}/,
];
const findings = [];
for (const file of textFiles) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of secretPatterns) if (pattern.test(text)) findings.push({ file, pattern: String(pattern) });
}
writeFileSync(`${out}/secret-scan.json`, `${JSON.stringify({
  ok: findings.length === 0,
  files: textFiles.length,
  findings,
}, null, 2)}\n`);

const manifests = [
  'package-lock.json',
  'android/build.gradle.kts',
  'android/settings.gradle.kts',
  'android/gradle/verification-metadata.xml',
  ...gradleLockFiles,
].map((file) => ({ file, sha256: sha256(readFileSync(file)), size: statSync(file).size }));
writeFileSync(`${out}/dependency-provenance.json`, `${JSON.stringify({
  schema: 'zungun.dependency-provenance.v2',
  npmComponents: npmComponents.length,
  gradleComponents: gradleComponents.length,
  manifests,
}, null, 2)}\n`);

for (const file of ['sbom.cdx.json', 'licenses.json', 'provenance.json', 'secret-scan.json', 'dependency-provenance.json']) {
  const bytes = readFileSync(`${out}/${file}`);
  writeFileSync(`${out}/${file}.sha256`, `${sha256(bytes)}  ${file}\n`);
}
console.log(JSON.stringify({
  ok: findings.length === 0,
  sbomComponents: components.length,
  npmComponents: npmComponents.length,
  gradleComponents: gradleComponents.length,
  trackedFiles: tracked.length,
  secretFindings: findings.length,
}));
if (findings.length > 0) process.exitCode = 1;
