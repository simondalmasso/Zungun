import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowPath = path.join(root, 'github-plan/.github/workflows/zep-canary-toolchain-evidence.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifestLines = fs.readFileSync(path.join(root, 'github-plan/materialization.tsv'), 'utf8').trim().split('\n');
if (manifestLines.shift() !== 'SOURCE_PATH\tREPOSITORY_PATH\tSIZE_BYTES\tSHA256') throw new Error('BAD_MATERIALIZATION_HEADER');
const rows = manifestLines.filter(Boolean).map((line) => line.split('\t'));
const issues = [];

const required = [
  'workflow_dispatch:',
  'permissions:\n  contents: read',
  'persist-credentials: false',
  'npm run dry-run',
  'WRANGLER_OUTPUT_FILE_DIRECTORY',
  'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd',
  'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
  'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f',
];
for (const item of required) if (!workflow.includes(item)) issues.push(`MISSING:${item}`);
for (const forbidden of [
  '${{ secrets.', 'wrangler versions upload', 'wrangler secret', 'wrangler delete',
  'git push', '\npush:', '\npull_request:', 'permissions:\n  contents: write',
]) {
  if (workflow.includes(forbidden)) issues.push(`FORBIDDEN:${forbidden}`);
}
if (typeof pkg.scripts?.['dry-run'] !== 'string' || !pkg.scripts['dry-run'].includes('wrangler deploy --dry-run')) {
  issues.push('PACKAGE_DRY_RUN_NOT_EXACT');
}
if (/wrangler deploy(?![^\n]*--dry-run)/.test(pkg.scripts['dry-run'] ?? '')) issues.push('DEPLOY_WITHOUT_DRY_RUN');

const destinations = new Set();
for (const row of rows) {
  if (row.length !== 4) { issues.push(`BAD_MAPPING_ROW:${row.join('|')}`); continue; }
  const [source, destination, sizeText, expectedSha] = row;
  const sourcePath = path.join(root, source);
  if (!fs.existsSync(sourcePath)) issues.push(`MAPPING_SOURCE_MISSING:${source}`);
  else {
    const crypto = await import('node:crypto');
    const actualSize = fs.statSync(sourcePath).size;
    const actualSha = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
    if (String(actualSize) !== sizeText) issues.push(`MAPPING_SIZE_MISMATCH:${source}`);
    if (actualSha !== expectedSha) issues.push(`MAPPING_HASH_MISMATCH:${source}`);
  }
  const parts = destination.split('/');
  if (destination.startsWith('/') || parts.includes('..')) issues.push(`UNSAFE_DEST:${destination}`);
  if (!(destination.startsWith('canary/zep-core-canary/') || destination === '.github/workflows/zep-canary-toolchain-evidence.yml')) {
    issues.push(`OUT_OF_SCOPE_DEST:${destination}`);
  }
  if (destinations.has(destination)) issues.push(`DESTINATION_COLLISION:${destination}`);
  destinations.add(destination);
}
if (rows.some(([source]) => source.startsWith('evidence/') || source.startsWith('github-plan/') && !source.includes('/.github/workflows/'))) issues.push('AUDIT_METADATA_MATERIALIZED');

const result = {
  ok: issues.length === 0,
  workflow: path.relative(root, workflowPath),
  materializationEntries: rows.length,
  uniqueDestinations: destinations.size,
  permissions: 'contents:read',
  trigger: 'workflow_dispatch',
  actionPins: 3,
  secretReferences: workflow.includes('${{ secrets.') ? 1 : 0,
  deployCommandsWithoutDryRun: issues.filter((issue) => issue.includes('DEPLOY_WITHOUT_DRY_RUN')).length,
  issues,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(1);
