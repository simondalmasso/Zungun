export type DoctorSeverity = 'ERROR' | 'WARNING' | 'INFO';
export type DoctorRuleId =
  | 'ZL001_UNSAFE_SIDE_EFFECT_RETRY'
  | 'ZL002_MISSING_IDEMPOTENCY_CONTRACT'
  | 'ZL003_STALE_CONNECTIVITY_BOOLEAN'
  | 'ZL004_NO_DURABLE_MUTATION_OUTBOX'
  | 'ZL005_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_FAILURE'
  | 'ZL006_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_SUCCESS'
  | 'ZL007_NO_SEMANTIC_REVALIDATION_FOR_DELAYED_ACTION'
  | 'ZL008_MONOLITHIC_LARGE_MUTATION'
  | 'ZL009_NON_RESUMABLE_LARGE_UPLOAD'
  | 'ZL010_BULK_CAN_STARVE_CRITICAL'
  | 'ZL011_NO_PROCESS_DEATH_RECOVERY'
  | 'ZL012_NO_REBOOT_RECOVERY'
  | 'ZL013_SECRET_OR_PAYLOAD_DIAGNOSTIC_RISK'
  | 'ZL014_NO_OPERATION_EXPIRY'
  | 'ZL015_NO_RECEIVER_RECONCILIATION_PATH'
  | 'ZL016_CONNECTED_WITHOUT_VALIDATION_CHECK';

export interface DoctorFinding {
  readonly ruleId: DoctorRuleId;
  readonly severity: DoctorSeverity;
  readonly location: string;
  readonly evidence: string;
  readonly explanation: string;
  readonly limitations: string;
  readonly recommendedTier: 'L0' | 'L1' | 'L2';
}

function finding(ruleId: DoctorRuleId, severity: DoctorSeverity, location: string, evidence: string, explanation: string, tier: 'L0'|'L1'|'L2'): DoctorFinding {
  return Object.freeze({ ruleId, severity, location, evidence: evidence.slice(0, 220), explanation, limitations: 'Static heuristic; verify control flow and domain semantics before changing production behavior.', recommendedTier: tier });
}

export function analyzeSource(path: string, text: string): readonly DoctorFinding[] {
  const out: DoctorFinding[] = [];
  const loc = path;
  if (/\bretry\b|Result\.retry\(\)|setBackoffCriteria/i.test(text)) {
    if (!/idempoten|reconcile|receiver.?query/i.test(text)) out.push(finding('ZL001_UNSAFE_SIDE_EFFECT_RETRY','ERROR',loc,'retry behavior without visible idempotency/reconciliation contract','Automatic side-effect retry can duplicate effects after ambiguous responses.','L1'));
  }
  if (/\b(POST|post\(|enqueue|mutation|write|submit)\b/i.test(text) && !/idempoten/i.test(text)) out.push(finding('ZL002_MISSING_IDEMPOTENCY_CONTRACT','WARNING',loc,'mutation-like operation without idempotency marker','Mutation delivery needs an explicit idempotency contract or conservative retry policy.','L1'));
  if (/\bisConnected\b|\bconnected\s*[=:]/i.test(text)) out.push(finding('ZL003_STALE_CONNECTIVITY_BOOLEAN','WARNING',loc,'boolean connectivity state detected','Cached booleans go stale; prefer callback-driven LinkSnapshot evidence.','L0'));
  if (/\b(POST|post\(|enqueue|mutation|submit)\b/i.test(text) && !/Room|SQLite|WorkManager|outbox|durable/i.test(text)) out.push(finding('ZL004_NO_DURABLE_MUTATION_OUTBOX','WARNING',loc,'mutation path without durable queue marker','Process death can lose pending operations without durable local state.','L0'));
  if (/timeout/i.test(text) && /FAILED|failure|throw/i.test(text) && !/UNKNOWN|ambiguous/i.test(text)) out.push(finding('ZL005_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_FAILURE','ERROR',loc,'timeout mapped to failure without UNKNOWN state','A timeout after send does not prove the receiver rejected or missed the operation.','L1'));
  if (/timeout/i.test(text) && /SUCCESS|success|complete/i.test(text) && !/receipt|ack|UNKNOWN|ambiguous/i.test(text)) out.push(finding('ZL006_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_SUCCESS','ERROR',loc,'timeout near success path without receipt evidence','Transport completion is not business-effect proof.','L2'));
  if (/WorkManager|background|defer|delayed/i.test(text) && !/semantic.?revalid/i.test(text)) out.push(finding('ZL007_NO_SEMANTIC_REVALIDATION_FOR_DELAYED_ACTION','WARNING',loc,'delayed execution without semantic revalidation marker','An operation can become invalid while waiting for connectivity.','L0'));
  if (/multipart|file|upload/i.test(text) && /payload|body/i.test(text) && !/chunk|defer|core|manifest/i.test(text)) out.push(finding('ZL008_MONOLITHIC_LARGE_MUTATION','WARNING',loc,'file/upload path without split marker','Large monolithic mutations increase failure cost on constrained links.','L0'));
  if (/upload/i.test(text) && !/resume|offset|range|chunk/i.test(text)) out.push(finding('ZL009_NON_RESUMABLE_LARGE_UPLOAD','WARNING',loc,'upload path without resume marker','Large uploads should checkpoint progress or safely restart by content identity.','L0'));
  if (/queue|scheduler/i.test(text) && !/priority|urgency|deadline|fair/i.test(text)) out.push(finding('ZL010_BULK_CAN_STARVE_CRITICAL','WARNING',loc,'queue/scheduler without priority or fairness marker','Bulk work can consume constrained transfer opportunities ahead of critical work.','L0'));
  if (/WorkManager|queue|outbox/i.test(text) && !/process.?death|recovery|Room|SQLite/i.test(text)) out.push(finding('ZL011_NO_PROCESS_DEATH_RECOVERY','WARNING',loc,'background queue without process-death recovery marker','Durability should be proven across process death.','L0'));
  if (/WorkManager|queue|outbox/i.test(text) && !/BOOT_COMPLETED|boot|recovery/i.test(text)) out.push(finding('ZL012_NO_REBOOT_RECOVERY','WARNING',loc,'background queue without reboot recovery marker','Long-lived pending work should have a reboot recovery contract.','L0'));
  if (/console\.log|Log\.[divew]|print/i.test(text) && /(password|token|authorization|payload|body)/i.test(text)) out.push(finding('ZL013_SECRET_OR_PAYLOAD_DIAGNOSTIC_RISK','ERROR',loc,'diagnostic output near secret/payload identifiers','Diagnostics should log commitments and safe metadata, not secrets or raw payloads.','L0'));
  if (/\b(POST|post\(|enqueue|mutation|submit)\b/i.test(text) && !/expire|ttl|deadline/i.test(text)) out.push(finding('ZL014_NO_OPERATION_EXPIRY','WARNING',loc,'mutation-like operation without expiry/deadline marker','Delayed operations need an explicit point after which they must not execute.','L0'));
  if (/retry|timeout|UNKNOWN|ambiguous/i.test(text) && !/reconcile|receiver.?query|status.?query/i.test(text)) out.push(finding('ZL015_NO_RECEIVER_RECONCILIATION_PATH','WARNING',loc,'uncertain/retry path without receiver reconciliation marker','Ambiguous outcomes need a receiver-side query before side-effect retry.','L1'));
  if (/NET_CAPABILITY_INTERNET|isConnected|hasNetwork/i.test(text) && !/NET_CAPABILITY_VALIDATED|validated/i.test(text)) out.push(finding('ZL016_CONNECTED_WITHOUT_VALIDATION_CHECK','WARNING',loc,'internet/connectivity marker without validation marker','A connected network may be captive or unable to reach the Internet.','L0'));
  return Object.freeze(out);
}

function pathsFromOpenApi(text: string): readonly { method: string; path: string; explicitRetry: string | null; idempotency: boolean }[] {
  try {
    const value = JSON.parse(text) as any;
    if (!value || typeof value !== 'object' || typeof value.openapi !== 'string' || !value.openapi.startsWith('3.')) throw new Error('UNSUPPORTED_OPENAPI');
    const rows: { method: string; path: string; explicitRetry: string | null; idempotency: boolean }[] = [];
    for (const [path, item] of Object.entries(value.paths ?? {})) for (const method of ['post','put','patch','delete']) {
      const op = (item as any)?.[method]; if (!op) continue;
      rows.push({ method: method.toUpperCase(), path, explicitRetry: typeof op['x-zungun-retry-contract'] === 'string' ? op['x-zungun-retry-contract'] : null, idempotency: Boolean(op['x-zungun-idempotency-required']) });
    }
    return rows;
  } catch (error) {
    if (error instanceof SyntaxError) {
      if (!/^\s*openapi:\s*["']?3\./m.test(text)) throw new Error('UNSUPPORTED_OPENAPI');
      const rows: { method: string; path: string; explicitRetry: string | null; idempotency: boolean }[] = [];
      let currentPath = '';
      let current: { method: string; path: string; explicitRetry: string | null; idempotency: boolean } | null = null;
      for (const line of text.split(/\r?\n/)) {
        const p = /^\s{2}([^\s].*):\s*$/.exec(line); if (p && p[1]!.startsWith('/')) { if (current) rows.push(current); current = null; currentPath = p[1]!; continue; }
        const m = /^\s{4}(post|put|patch|delete):\s*$/i.exec(line); if (m) { if (current) rows.push(current); current = { method: m[1]!.toUpperCase(), path: currentPath, explicitRetry: null, idempotency: false }; continue; }
        if (current) {
          const r = /^\s+x-zungun-retry-contract:\s*["']?([^"'\s]+)["']?/.exec(line); if (r) current.explicitRetry = r[1]!;
          const i = /^\s+x-zungun-idempotency-required:\s*true\s*$/i.exec(line); if (i) current.idempotency = true;
        }
      }
      if (current) rows.push(current);
      return rows;
    }
    throw error;
  }
}

export interface DoctorScaffoldOperation { readonly method: string; readonly path: string; readonly retryContract: 'UNKNOWN_REQUIRES_ANNOTATION' | string; readonly idempotencyRequired: boolean; }
export interface DoctorOpenApiResult { readonly findings: readonly DoctorFinding[]; readonly scaffold: { readonly version: 1; readonly operations: readonly DoctorScaffoldOperation[] } }

export function analyzeOpenApi(text: string, location = 'openapi'): DoctorOpenApiResult {
  const operations = pathsFromOpenApi(text);
  const findings: DoctorFinding[] = [];
  const scaffold = operations.map((op) => {
    const retryContract = op.explicitRetry ?? 'UNKNOWN_REQUIRES_ANNOTATION';
    if (!op.explicitRetry) findings.push(finding('ZL001_UNSAFE_SIDE_EFFECT_RETRY','WARNING',`${location}:${op.method} ${op.path}`,'mutating operation has no x-zungun-retry-contract','Doctor never assumes a mutation is retry-safe; annotate domain semantics explicitly.','L1'));
    if (!op.idempotency) findings.push(finding('ZL002_MISSING_IDEMPOTENCY_CONTRACT','WARNING',`${location}:${op.method} ${op.path}`,'x-zungun-idempotency-required is absent/false','Declare idempotency only when the receiver enforces it.','L1'));
    return Object.freeze({ method: op.method, path: op.path, retryContract, idempotencyRequired: op.idempotency });
  });
  return Object.freeze({ findings: Object.freeze(findings), scaffold: Object.freeze({ version: 1 as const, operations: Object.freeze(scaffold) }) });
}
