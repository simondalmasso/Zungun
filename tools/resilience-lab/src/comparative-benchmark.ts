import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { verifyLinkProofBundle } from '../../../packages/link-core/src/index.js';
import {
  LinkReceiverProxy,
  SqliteLinkProxyStore,
  type LinkProxyInvocation,
  type LinkProxyInvocationResult,
  type LinkProxyInvoker,
  type LinkProxyRequest,
  type LinkProxyRoute,
} from '../../../services/receiver/src/link-proxy.js';
import { runLinkBlackoutDrill } from './link-blackout-drill.js';

const BASE_TIME_MS = 1_800_000_000_000;
const ROUTE: LinkProxyRoute = Object.freeze({
  routeId: 'orders',
  targetOrigin: 'https://api.example.com',
  pathPrefix: '/v1/orders',
  allowedMethods: Object.freeze(['POST'] as const),
  maxRequestBytes: 1_000_000,
  maxResponseBytes: 65_536,
  timeoutMs: 5_000,
  allowedRequestHeaders: Object.freeze(['content-type']),
});

export type ComparativeLaneName =
  | 'direct-http-no-idempotency'
  | 'direct-http-idempotent-receiver'
  | 'sqlite-outbox-idempotent-receiver'
  | 'zungun-link-reconcile';

export interface ComparativeLaneMetrics {
  readonly lane: ComparativeLaneName;
  readonly executionMode: string;
  readonly operations: number;
  readonly sideEffectRequests: number;
  readonly reconciliationQueries: number;
  readonly totalNetworkCalls: number;
  readonly businessEffects: number;
  readonly duplicateBusinessEffects: number;
  readonly deduplicatedSideEffectRequests: number;
  readonly unknownOutcomesBeforeResolution: number;
  readonly unresolvedOutcomesAfterResolution: number;
  readonly durableSenderRecords: number | null;
  readonly pendingSenderRecords: number | null;
  readonly durableReceiverRecords: number;
  readonly durableProxyRecords: number;
  readonly replayChecksPassed: number | null;
}

export interface ComparativeAssuranceBenchmarkReport {
  readonly schema: 'zungun.comparative-assurance-benchmark.v1';
  readonly trialsPerLane: number;
  readonly faultProfile: string;
  readonly executionBoundary: string;
  readonly lanes: readonly ComparativeLaneMetrics[];
  readonly integratedLinkProof: {
    readonly operations: number;
    readonly businessEffectCount: number;
    readonly secondSideEffectSendCount: number;
    readonly transportAttemptCount: number;
    readonly reconciliationQueryCount: number;
    readonly finalCoreComplete: boolean;
    readonly finalEvidenceComplete: boolean;
    readonly proofBundleVerified: boolean;
    readonly proofManifestSha256: string;
  };
  readonly interpretation: readonly string[];
  readonly ok: boolean;
}

function createIdempotencyLedger(database: DatabaseSync): void {
  database.exec('CREATE TABLE IF NOT EXISTS receiver_idempotency (idempotency_key TEXT PRIMARY KEY, effect_reference TEXT NOT NULL, response_json TEXT NOT NULL)');
}

function applyIdempotent(database: DatabaseSync, idempotencyKey: string, operationId: string): boolean {
  const existing = database.prepare(
    'SELECT effect_reference FROM receiver_idempotency WHERE idempotency_key = ?',
  ).get(idempotencyKey) as { effect_reference: string } | undefined;
  if (existing) return false;
  database.prepare(
    'INSERT INTO receiver_idempotency(idempotency_key,effect_reference,response_json) VALUES(?,?,?)',
  ).run(idempotencyKey, 'effect:' + operationId, '{"accepted":true}');
  return true;
}

function countRows(database: DatabaseSync, query: string): number {
  const row = database.prepare(query).get() as { count: number | bigint };
  return Number(row.count);
}

function identifier(index: number): string {
  return String(index).padStart(6, '0');
}

function runDirectHttpWithoutIdempotency(trials: number): ComparativeLaneMetrics {
  return Object.freeze({
    lane: 'direct-http-no-idempotency',
    executionMode: 'deterministic-model',
    operations: trials,
    sideEffectRequests: trials * 2,
    reconciliationQueries: 0,
    totalNetworkCalls: trials * 2,
    businessEffects: trials * 2,
    duplicateBusinessEffects: trials,
    deduplicatedSideEffectRequests: 0,
    unknownOutcomesBeforeResolution: trials,
    unresolvedOutcomesAfterResolution: 0,
    durableSenderRecords: 0,
    pendingSenderRecords: 0,
    durableReceiverRecords: 0,
    durableProxyRecords: 0,
    replayChecksPassed: null,
  });
}

function runDirectHttpWithIdempotentReceiver(trials: number, databasePath: string): ComparativeLaneMetrics {
  const database = new DatabaseSync(databasePath);
  createIdempotencyLedger(database);
  let sideEffectRequests = 0;
  let businessEffects = 0;
  let deduplicatedSideEffectRequests = 0;
  try {
    for (let index = 1; index <= trials; index += 1) {
      const operationId = 'direct_' + identifier(index);
      const key = 'direct_idem_' + identifier(index);
      sideEffectRequests += 1;
      if (applyIdempotent(database, key, operationId)) businessEffects += 1;
      // The first committed response is lost; the caller observes UNKNOWN.
      sideEffectRequests += 1;
      if (applyIdempotent(database, key, operationId)) businessEffects += 1;
      else deduplicatedSideEffectRequests += 1;
    }
    return Object.freeze({
      lane: 'direct-http-idempotent-receiver',
      executionMode: 'SQLite receiver idempotency reference model',
      operations: trials,
      sideEffectRequests,
      reconciliationQueries: 0,
      totalNetworkCalls: sideEffectRequests,
      businessEffects,
      duplicateBusinessEffects: businessEffects - trials,
      deduplicatedSideEffectRequests,
      unknownOutcomesBeforeResolution: trials,
      unresolvedOutcomesAfterResolution: 0,
      durableSenderRecords: 0,
      pendingSenderRecords: 0,
      durableReceiverRecords: countRows(database, 'SELECT COUNT(*) AS count FROM receiver_idempotency'),
      durableProxyRecords: 0,
      replayChecksPassed: deduplicatedSideEffectRequests,
    });
  } finally {
    database.close();
  }
}

function runSqliteOutboxBaseline(trials: number, directory: string): ComparativeLaneMetrics {
  const sender = new DatabaseSync(join(directory, 'outbox-sender.sqlite'));
  const receiver = new DatabaseSync(join(directory, 'outbox-receiver.sqlite'));
  sender.exec('CREATE TABLE outbox (operation_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, payload_sha256 TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN (\'PENDING\',\'ACKED\')), attempts INTEGER NOT NULL DEFAULT 0)');
  createIdempotencyLedger(receiver);
  let sideEffectRequests = 0;
  let businessEffects = 0;
  let deduplicatedSideEffectRequests = 0;
  try {
    for (let index = 1; index <= trials; index += 1) {
      const suffix = identifier(index);
      const operationId = 'outbox_' + suffix;
      const key = 'outbox_idem_' + suffix;
      const payloadSha256 = createHash('sha256').update('payload:' + operationId).digest('hex');
      sender.prepare(
        'INSERT INTO outbox(operation_id,idempotency_key,payload_sha256,state,attempts) VALUES(?,?,?, ?,0)',
      ).run(operationId, key, payloadSha256, 'PENDING');

      // Attempt one commits the effect; only its response is lost.
      sideEffectRequests += 1;
      if (applyIdempotent(receiver, key, operationId)) businessEffects += 1;
      sender.prepare('UPDATE outbox SET attempts=1 WHERE operation_id=?').run(operationId);

      // The conventional durable outbox retries the same key. The receiver returns
      // the stored response without applying the business effect a second time.
      sideEffectRequests += 1;
      if (applyIdempotent(receiver, key, operationId)) businessEffects += 1;
      else deduplicatedSideEffectRequests += 1;
      sender.prepare('UPDATE outbox SET state=?,attempts=2 WHERE operation_id=?').run('ACKED', operationId);
    }
    const durableSenderRecords = countRows(sender, 'SELECT COUNT(*) AS count FROM outbox');
    const pendingSenderRecords = countRows(sender, "SELECT COUNT(*) AS count FROM outbox WHERE state='PENDING'");
    return Object.freeze({
      lane: 'sqlite-outbox-idempotent-receiver',
      executionMode: 'SQLite durable outbox + SQLite receiver idempotency reference baseline',
      operations: trials,
      sideEffectRequests,
      reconciliationQueries: 0,
      totalNetworkCalls: sideEffectRequests,
      businessEffects,
      duplicateBusinessEffects: businessEffects - trials,
      deduplicatedSideEffectRequests,
      unknownOutcomesBeforeResolution: trials,
      unresolvedOutcomesAfterResolution: 0,
      durableSenderRecords,
      pendingSenderRecords,
      durableReceiverRecords: countRows(receiver, 'SELECT COUNT(*) AS count FROM receiver_idempotency'),
      durableProxyRecords: 0,
      replayChecksPassed: deduplicatedSideEffectRequests,
    });
  } finally {
    sender.close();
    receiver.close();
  }
}

class FaultingQueryableUpstream implements LinkProxyInvoker {
  readonly droppedResponseKeys = new Set<string>();
  sideEffectRequests = 0;
  businessEffects = 0;
  duplicateBusinessEffects = 0;
  deduplicatedSideEffectRequests = 0;
  reconciliationQueries = 0;

  constructor(private readonly database: DatabaseSync) {
    createIdempotencyLedger(database);
  }

  async invoke(input: LinkProxyInvocation): Promise<LinkProxyInvocationResult> {
    const key = input.headers['idempotency-key'];
    if (!key) throw new Error('BENCHMARK_IDEMPOTENCY_KEY_MISSING');
    this.sideEffectRequests += 1;
    if (applyIdempotent(this.database, key, key)) {
      this.businessEffects += 1;
    } else {
      this.deduplicatedSideEffectRequests += 1;
    }
    if (!this.droppedResponseKeys.has(key)) {
      this.droppedResponseKeys.add(key);
      throw new Error('FAULT_DROP_RESPONSE_AFTER_DURABLE_COMMIT');
    }
    return Object.freeze({
      status: 202,
      headers: Object.freeze({}),
      body: new TextEncoder().encode('{"accepted":true}'),
    });
  }

  async query(_route: LinkProxyRoute, idempotencyKey: string): Promise<'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN'> {
    this.reconciliationQueries += 1;
    const existing = this.database.prepare(
      'SELECT effect_reference FROM receiver_idempotency WHERE idempotency_key = ?',
    ).get(idempotencyKey);
    return existing ? 'APPLIED' : 'NOT_APPLIED';
  }
}

async function runZungunLinkProxy(trials: number, directory: string): Promise<ComparativeLaneMetrics> {
  const proxyDatabase = new DatabaseSync(join(directory, 'zungun-proxy.sqlite'));
  const upstreamDatabase = new DatabaseSync(join(directory, 'zungun-upstream.sqlite'));
  const upstream = new FaultingQueryableUpstream(upstreamDatabase);
  const proxy = new LinkReceiverProxy([ROUTE], new SqliteLinkProxyStore(proxyDatabase), upstream);
  let unknownOutcomesBeforeResolution = 0;
  let replayChecksPassed = 0;
  try {
    for (let index = 1; index <= trials; index += 1) {
      const suffix = identifier(index);
      const operationId = 'zungun_op_' + suffix;
      const request: LinkProxyRequest = Object.freeze({
        operationId,
        idempotencyKey: 'zungun_idem_' + suffix,
        routeId: ROUTE.routeId,
        method: 'POST',
        relativePath: '/confirm',
        headers: Object.freeze({ 'content-type': 'application/json' }),
        body: new TextEncoder().encode(JSON.stringify({ operationId, sequence: index })),
        createdAtMs: BASE_TIME_MS + index * 10,
      });
      const first = await proxy.execute(request, BASE_TIME_MS + index * 10 + 1);
      if (first.record.state !== 'UNKNOWN') throw new Error('BENCHMARK_EXPECTED_UNKNOWN_AFTER_RESPONSE_LOSS');
      unknownOutcomesBeforeResolution += 1;

      const reconciled = await proxy.reconcile(operationId, BASE_TIME_MS + index * 10 + 2);
      if (!reconciled || reconciled.state !== 'UPSTREAM_ACCEPTED') {
        throw new Error('BENCHMARK_RECONCILIATION_DID_NOT_CONFIRM_EFFECT');
      }

      const replay = await proxy.execute(request, BASE_TIME_MS + index * 10 + 3);
      if (!replay.duplicate || replay.record.state !== 'UPSTREAM_ACCEPTED') {
        throw new Error('BENCHMARK_DUPLICATE_REPLAY_NOT_BLOCKED');
      }
      replayChecksPassed += 1;
    }
    const durableProxyRecords = countRows(proxyDatabase, 'SELECT COUNT(*) AS count FROM link_proxy_operations');
    const durableReceiverRecords = countRows(upstreamDatabase, 'SELECT COUNT(*) AS count FROM receiver_idempotency');
    return Object.freeze({
      lane: 'zungun-link-reconcile',
      executionMode: 'actual LinkReceiverProxy + SQLite proxy ledger + SQLite upstream idempotency ledger',
      operations: trials,
      sideEffectRequests: upstream.sideEffectRequests,
      reconciliationQueries: upstream.reconciliationQueries,
      totalNetworkCalls: upstream.sideEffectRequests + upstream.reconciliationQueries,
      businessEffects: upstream.businessEffects,
      duplicateBusinessEffects: upstream.duplicateBusinessEffects,
      deduplicatedSideEffectRequests: upstream.deduplicatedSideEffectRequests,
      unknownOutcomesBeforeResolution,
      unresolvedOutcomesAfterResolution: 0,
      durableSenderRecords: null,
      pendingSenderRecords: null,
      durableReceiverRecords,
      durableProxyRecords,
      replayChecksPassed,
    });
  } finally {
    proxyDatabase.close();
    upstreamDatabase.close();
  }
}

export async function runComparativeAssuranceBenchmark(
  trials = 1_000,
): Promise<ComparativeAssuranceBenchmarkReport> {
  if (!Number.isSafeInteger(trials) || trials < 1 || trials > 10_000) {
    throw new Error('BENCHMARK_TRIALS_MUST_BE_INTEGER_1_TO_10000');
  }
  const directory = mkdtempSync(join(tmpdir(), 'zungun-comparative-assurance-'));
  try {
    const directHttp = runDirectHttpWithoutIdempotency(trials);
    const directHttpIdempotent = runDirectHttpWithIdempotentReceiver(
      trials,
      join(directory, 'direct-idempotent-receiver.sqlite'),
    );
    const outbox = runSqliteOutboxBaseline(trials, directory);
    const zungun = await runZungunLinkProxy(trials, directory);
    const lanes: readonly ComparativeLaneMetrics[] = [
      directHttp,
      directHttpIdempotent,
      outbox,
      zungun,
    ];

    // This separate integrated drill validates the Link proof chain. It is one
    // end-to-end proof exemplar, not a claim of 1,000 signed proof bundles.
    const drill = await runLinkBlackoutDrill();
    const proofBundleVerified = verifyLinkProofBundle(drill.proofBundle);
    const integratedLinkProof = Object.freeze({
      operations: 1,
      businessEffectCount: drill.businessEffectCount,
      secondSideEffectSendCount: drill.secondSideEffectSendCount,
      transportAttemptCount: drill.transportAttemptCount,
      reconciliationQueryCount: drill.reconciliationQueryCount,
      finalCoreComplete: drill.finalCoreComplete,
      finalEvidenceComplete: drill.finalEvidenceComplete,
      proofBundleVerified,
      proofManifestSha256: drill.proofManifestSha256,
    });

    const ok =
      directHttp.businessEffects === trials * 2 &&
      directHttp.duplicateBusinessEffects === trials &&
      directHttpIdempotent.businessEffects === trials &&
      directHttpIdempotent.duplicateBusinessEffects === 0 &&
      directHttpIdempotent.deduplicatedSideEffectRequests === trials &&
      outbox.businessEffects === trials &&
      outbox.duplicateBusinessEffects === 0 &&
      outbox.durableSenderRecords === trials &&
      outbox.pendingSenderRecords === 0 &&
      outbox.deduplicatedSideEffectRequests === trials &&
      zungun.businessEffects === trials &&
      zungun.duplicateBusinessEffects === 0 &&
      zungun.sideEffectRequests === trials &&
      zungun.reconciliationQueries === trials &&
      zungun.durableProxyRecords === trials &&
      zungun.replayChecksPassed === trials &&
      zungun.unresolvedOutcomesAfterResolution === 0 &&
      proofBundleVerified &&
      integratedLinkProof.businessEffectCount === 1 &&
      integratedLinkProof.secondSideEffectSendCount === 0 &&
      integratedLinkProof.finalCoreComplete &&
      integratedLinkProof.finalEvidenceComplete;

    return Object.freeze({
      schema: 'zungun.comparative-assurance-benchmark.v1',
      trialsPerLane: trials,
      faultProfile: 'UPSTREAM_COMMIT_THEN_DROP_RESPONSE; caller observes UNKNOWN before recovery',
      executionBoundary: 'Deterministic in-process fault injection with SQLite reference stores. This does not execute Android Room/WorkManager, OEM background policies, a real network, NTN/satellite links, or production traffic.',
      lanes,
      integratedLinkProof,
      interpretation: Object.freeze([
        'The non-idempotent direct-HTTP model produces one duplicate business effect per operation under response loss after commit.',
        'A correctly implemented idempotent receiver makes both direct retry and a durable SQLite outbox correct for this fault profile; Zungun does not claim a duplicate-correctness advantage over that strong baseline.',
        'The outbox baseline uses two side-effect requests per operation. The Zungun proxy path uses one side-effect request plus one reconciliation query; total request count is equal in this profile, but the second call is read-only reconciliation rather than another side-effect send.',
        'The 1,000-trial proxy run records durable proxy state and blocks repeated submission. The separate integrated Link blackout drill verifies one proof bundle; it does not establish 1,000 signed proof bundles.',
        'This is a contract/correctness harness, not a latency, throughput, Android OEM reliability, satellite performance, customer savings, willingness-to-pay, or production-readiness study.',
      ]),
      ok,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const requestedTrials = process.argv[2] === undefined ? 1_000 : Number(process.argv[2]);
  const report = await runComparativeAssuranceBenchmark(requestedTrials);
  const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  mkdirSync('.artifacts/resilience', { recursive: true });
  writeFileSync('.artifacts/resilience/comparative-assurance-benchmark.json', bytes);
  writeFileSync(
    '.artifacts/resilience/comparative-assurance-benchmark.sha256',
    createHash('sha256').update(bytes).digest('hex') + '  comparative-assurance-benchmark.json\n',
  );
  console.log(JSON.stringify({
    ok: report.ok,
    trialsPerLane: report.trialsPerLane,
    lanes: report.lanes.map((lane) => ({
      lane: lane.lane,
      sideEffectRequests: lane.sideEffectRequests,
      reconciliationQueries: lane.reconciliationQueries,
      businessEffects: lane.businessEffects,
      duplicateBusinessEffects: lane.duplicateBusinessEffects,
      unresolvedOutcomesAfterResolution: lane.unresolvedOutcomesAfterResolution,
    })),
    proofBundleVerified: report.integratedLinkProof.proofBundleVerified,
    proofManifestSha256: report.integratedLinkProof.proofManifestSha256,
    reportSha256: createHash('sha256').update(bytes).digest('hex'),
  }));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('comparative-benchmark.js')) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
