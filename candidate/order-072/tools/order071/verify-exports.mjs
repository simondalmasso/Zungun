import fs from 'node:fs';
import path from 'node:path';
import * as root from '../../dist/canary/zep-core-canary/vendor/zep-core/src/index.js';
import * as extensions from '../../dist/candidate/order-072/src/extensions/index.js';

const cwd = process.cwd();
const evidenceDir = path.join(cwd, 'evidence/order072'); fs.mkdirSync(evidenceDir, { recursive: true });
const expectedLines = fs.readFileSync(path.join(cwd, '../../canary/zep-core-canary/vendor/zep-core/evidence/runtime-exports.txt'), 'utf8').trim().split(/\r?\n/);
const declaredCount = Number(expectedLines.shift()?.split('=')[1]);
const expected = expectedLines.sort();
const actual = Object.keys(root).sort();
const extensionExports = Object.keys(extensions).sort();
const missing = expected.filter((name) => !actual.includes(name));
const extra = actual.filter((name) => !expected.includes(name));
const forbidden069r = [
  'ReferenceReceiver', 'ZungunError', 'buildExecutionProof', 'canonicalJson', 'chooseTransport',
  'computeMessageCommitment', 'createDemoReceipt', 'createWo2841Message', 'generateControlRoomKit',
  'generateWo2841Evidence', 'prettyCanonicalJson', 'reconcileOperation', 'runWo2841Demo', 'sha256',
  'verifyControlRoomKit', 'verifyReceipt',
].filter((name) => actual.includes(name));
const rootResult = {
  orderId: 'ZUNGUN-AUD-ARQ-CANONICAL-CANDIDATE-MATERIALIZATION-072',
  entrypoint: '.',
  expectedCount: declaredCount,
  actualCount: actual.length,
  exact: declaredCount === 49 && JSON.stringify(actual) === JSON.stringify(expected),
  missing,
  extra,
  forbidden069r,
  exports: actual,
};
const extensionResult = {
  orderId: 'ZUNGUN-AUD-ARQ-CANONICAL-CANDIDATE-MATERIALIZATION-072',
  entrypoint: './extensions',
  count: extensionExports.length,
  shadowsHistoricalRoot: extensionExports.filter((name) => expected.includes(name)),
  exports: extensionExports,
};
for (const [name, value] of [
  ['export-surface-root.json', rootResult],
  ['export-surface-extensions.json', extensionResult],
]) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(path.join(evidenceDir, name), text);
}
const ok = rootResult.exact && missing.length === 0 && extra.length === 0 && forbidden069r.length === 0 && extensionResult.shadowsHistoricalRoot.length === 0;
console.log(JSON.stringify({ ok, root: `${actual.length}/${declaredCount}`, missing: missing.length, extra: extra.length, forbidden069r: forbidden069r.length, extensionExports: extensionExports.length, extensionShadows: extensionResult.shadowsHistoricalRoot.length }));
if (!ok) process.exit(1);
