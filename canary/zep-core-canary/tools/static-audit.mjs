import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const issues = [];
const notes = [];
const sourceFiles = [
  'src/worker.ts', 'package.json', 'tsconfig.json', 'wrangler.jsonc',
  'github-plan/.github/workflows/zep-canary-toolchain-evidence.yml',
];
const texts = new Map(sourceFiles.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const worker = texts.get('src/worker.ts');
const workflow = texts.get('github-plan/.github/workflows/zep-canary-toolchain-evidence.yml');
const pkg = JSON.parse(texts.get('package.json'));
const config = JSON.parse(texts.get('wrangler.jsonc'));

for (const key of ['account_id','routes','route','vars','env','kv_namespaces','r2_buckets','d1_databases','durable_objects','services','queues','triggers']) {
  if (Object.prototype.hasOwnProperty.call(config, key)) issues.push(`FORBIDDEN_CONFIG_KEY:${key}`);
}
if (config.workers_dev !== true) issues.push('WORKERS_DEV_NOT_TRUE');
if (config.preview_urls !== false) issues.push('PREVIEW_URLS_NOT_FALSE');
if (config.main !== 'src/worker.ts') issues.push('ENTRYPOINT_MISMATCH');
if (config.name !== 'zungun-zep-core-canary') issues.push('WORKER_NAME_MISMATCH');

const forbiddenWorkerPatterns = [
  ['OUTBOUND_FETCH', /\b(?:await\s+|globalThis\.)fetch\s*\(/],
  ['WEBSOCKET', /\bWebSocket\b/],
  ['CACHE_API', /\bcaches\s*\.|\bCacheStorage\b/],
  ['PERSISTENCE_BINDING', /\b(?:KVNamespace|R2Bucket|D1Database|DurableObject|Queue)\b/],
  ['DYNAMIC_CODE', /\beval\s*\(|new\s+Function\b/],
  ['TIMERS', /\b(?:setTimeout|setInterval)\s*\(/],
  ['CORS_HEADER', /access-control-/i],
];
for (const [name, pattern] of forbiddenWorkerPatterns) if (pattern.test(worker)) issues.push(name);
for (const required of ["'cache-control': 'no-store'", "'x-content-type-options': 'nosniff'", "'x-frame-options': 'DENY'", 'MAX_REQUEST_BODY_BYTES = 65_536', 'MAX_DECODED_PAYLOAD_BYTES = 48_000']) {
  if (!worker.includes(required)) issues.push(`MISSING_SECURITY_BOUNDARY:${required}`);
}
if (!pkg.scripts?.['dry-run']?.includes('wrangler deploy --dry-run')) issues.push('DRY_RUN_SCRIPT_MISSING');
for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
  if (typeof script === 'string' && /wrangler deploy(?![^\n]*--dry-run)/.test(script)) issues.push(`DEPLOY_WITHOUT_DRY_RUN:${name}`);
  if (typeof script === 'string' && /wrangler (?:delete|secret|versions upload)/.test(script)) issues.push(`FORBIDDEN_WRANGLER_COMMAND:${name}`);
}
if (workflow.includes('${{ secrets.')) issues.push('WORKFLOW_SECRET_REFERENCE');
if (!workflow.includes('permissions:\n  contents: read')) issues.push('WORKFLOW_PERMISSIONS_NOT_READ_ONLY');
if (/\n\s*(?:push|pull_request):/.test(workflow)) issues.push('WORKFLOW_AUTOMATIC_TRIGGER');
if (!workflow.includes('workflow_dispatch:')) issues.push('WORKFLOW_NOT_MANUAL');
if (workflow.includes('git push')) issues.push('WORKFLOW_GIT_PUSH');

const symlinks = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (rel.startsWith('dist/') || rel.startsWith('node_modules/')) continue;
    if (entry.isSymbolicLink()) symlinks.push(rel);
    else if (entry.isDirectory()) walk(full);
  }
};
walk(root);
if (symlinks.length) issues.push(`SYMLINKS:${symlinks.join(',')}`);

const secretPatterns = [
  ['OPENAI_KEY', /sk-[A-Za-z0-9_-]{20,}/],
  ['GITHUB_TOKEN', /gh[pousr]_[A-Za-z0-9_]{20,}/],
  ['AWS_KEY', /AKIA[0-9A-Z]{16}/],
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const secretHits = [];
for (const file of sourceFiles) {
  const text = texts.get(file);
  for (const [name, pattern] of secretPatterns) if (pattern.test(text)) secretHits.push(`${name}:${file}`);
}
if (secretHits.length) issues.push(`SECRET_HITS:${secretHits.join(',')}`);

const result = {
  ok: issues.length === 0,
  sourceFilesScanned: sourceFiles.length,
  configKeys: Object.keys(config).sort(),
  bindings: 0,
  routes: 0,
  environments: 0,
  automaticWorkflowTriggers: 0,
  workflowSecretReferences: 0,
  symlinks,
  issues,
  notes,
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(1);
