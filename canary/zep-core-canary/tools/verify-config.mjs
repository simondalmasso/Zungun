import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const configPath = path.join(cwd, 'wrangler.jsonc');
const expectedKeys = [
  '$schema',
  'compatibility_date',
  'main',
  'name',
  'observability',
  'preview_urls',
  'workers_dev',
].sort();
const expectedObservabilityKeys = [
  'enabled',
  'head_sampling_rate',
].sort();

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  fail(`CONFIG_PARSE_FAILED:${error instanceof Error ? error.message : String(error)}`);
}

if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) fail('CONFIG_NOT_OBJECT');

const forbidden = [
  'account_id', 'routes', 'route', 'vars', 'secrets', 'kv_namespaces', 'r2_buckets',
  'd1_databases', 'durable_objects', 'services', 'queues', 'hyperdrive', 'vectorize',
  'ai', 'analytics_engine_datasets', 'unsafe_bindings', 'tail_consumers', 'logpush',
  'triggers', 'env', 'assets', 'dispatch_namespaces', 'mtls_certificates', 'browser',
  'images',
];
for (const key of forbidden) {
  if (Object.prototype.hasOwnProperty.call(parsed, key)) fail(`FORBIDDEN_CONFIG_KEY:${key}`);
}

const actualKeys = Object.keys(parsed).sort();
if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
  fail(`CONFIG_KEYS_MISMATCH:${actualKeys.join(',')}`);
}

const expected = {
  '$schema': './node_modules/wrangler/config-schema.json',
  name: 'zungun-zep-core-canary',
  main: 'src/worker.ts',
  compatibility_date: '2026-07-26',
  workers_dev: true,
  preview_urls: false,
};
for (const [key, value] of Object.entries(expected)) {
  if (parsed[key] !== value) fail(`CONFIG_VALUE_MISMATCH:${key}`);
}

const observability = parsed.observability;
if (typeof observability !== 'object' || observability === null || Array.isArray(observability)) {
  fail('OBSERVABILITY_NOT_OBJECT');
}
const actualObservabilityKeys = Object.keys(observability).sort();
if (JSON.stringify(actualObservabilityKeys) !== JSON.stringify(expectedObservabilityKeys)) {
  fail(`OBSERVABILITY_KEYS_MISMATCH:${actualObservabilityKeys.join(',')}`);
}
if (observability.enabled !== false) fail('OBSERVABILITY_ENABLED_NOT_FALSE');
if (observability.head_sampling_rate !== 0) fail('OBSERVABILITY_HEAD_SAMPLING_RATE_NOT_ZERO');

const redirectHits = [];
let current = cwd;
for (;;) {
  const candidate = path.join(current, '.wrangler', 'deploy', 'config.json');
  if (fs.existsSync(candidate)) redirectHits.push(candidate);
  const parent = path.dirname(current);
  if (parent === current || current === '/mnt/data') break;
  current = parent;
}
if (redirectHits.length !== 0) fail(`GENERATED_CONFIG_REDIRECT_FOUND:${redirectHits.join(',')}`);

console.log(JSON.stringify({
  ok: true,
  config: path.relative(cwd, configPath),
  workerName: parsed.name,
  main: parsed.main,
  compatibilityDate: parsed.compatibility_date,
  workersDev: parsed.workers_dev,
  previewUrls: parsed.preview_urls,
  observabilityExplicitlyConfigured: true,
  observabilityEnabled: observability.enabled,
  invocationLogsIntended: false,
  headSamplingRate: observability.head_sampling_rate,
  persistenceDeclaration: 'none',
  bindings: 0,
  customRoutes: 0,
  environments: 0,
  generatedConfigRedirects: 0,
}));
