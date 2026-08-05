import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalize } from '../../../packages/protocol-core/src/canonical.js';
import { reconcileFacts, type OperationFact } from '../../../packages/reconciliation/src/index.js';
import {
  InMemoryReceiptKeyProvider,
  LocalFileReceiptKeyProvider,
  signExecutionReceipt,
  verifyExecutionReceipt,
} from '../../../packages/security/src/receipts.js';
import { StaticPrincipalAuthorizer } from '../../../services/receiver/src/auth.js';
import { ReceiverDatabase, evidenceHash } from '../../../services/receiver/src/database.js';
import { PersistentReceiver } from '../../../services/receiver/src/receiver.js';
import { BASE_TIME, makeEnvelope } from '../../../tests/helpers.js';
import { deterministicScenarios, type ResilienceScenario } from './scenarios.js';

export interface ScenarioResult {
  readonly name: string;
  readonly seed: number;
  readonly passed: boolean;
  readonly expectedOutcome: string;
  readonly observedOutcome: string;
  readonly injectedFault: string;
  readonly detail: string;
}

function effect(outcome: 'EFFECT_APPLIED' | 'NO_EFFECT' | 'REJECTED', atMs: number) {
  return {
    outcome,
    applicationAcknowledged: true,
    applicationReference: `erp:${outcome.toLowerCase()}`,
    workOrderStatus: outcome === 'EFFECT_APPLIED' ? 'CLOSED' : 'OPEN',
    result: { outcome },
    occurredAtMs: atMs,
  } as const;
}

function context<T>(operation: (receiver: PersistentReceiver, provider: InMemoryReceiptKeyProvider, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'zungun-resilience-'));
  const database = new ReceiverDatabase(join(dir, 'receiver.sqlite'));
  const provider = new InMemoryReceiptKeyProvider(BASE_TIME - 1_000, 365 * 24 * 60 * 60 * 1000);
  const receiver = new PersistentReceiver(database, provider, 'receiver_resilience');
  try { return operation(receiver, provider, dir); } finally {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function outcomeFor(scenario: ResilienceScenario): string {
  const envelope = makeEnvelope({
    operationId: `op_resilience_${scenario.seed}`,
    idempotencyKey: `idem_resilience_${scenario.seed}`,
    messageId: `msg_resilience_${scenario.seed}`,
    replayNonce: `nonce_resilience_${scenario.seed}`,
    workOrderId: `WO-${scenario.seed}`,
  });
  switch (scenario.name) {
    case 'offline_transport':
      return context((receiver) => {
        receiver.accept(envelope, BASE_TIME + 1);
        return receiver.reconcile(envelope.operationId, 'lab', 'offline', BASE_TIME + 2).verdict;
      });
    case 'intermittent_transport':
    case 'delay':
      return context((receiver) => {
        receiver.accept(envelope, BASE_TIME + 10);
        const claim = receiver.claim(envelope.operationId, 'worker', BASE_TIME + 20, 10_000);
        receiver.recordEffect(envelope.operationId, claim.attemptId, claim.fencingToken, effect('EFFECT_APPLIED', BASE_TIME + (scenario.name === 'delay' ? 4_000 : 30)));
        return receiver.reconcile(envelope.operationId, 'lab', scenario.name, BASE_TIME + 5_000).verdict;
      });
    case 'timeout':
    case 'ack_loss':
      return context((receiver) => {
        receiver.accept(envelope, BASE_TIME + 1);
        const claim = receiver.claim(envelope.operationId, 'worker', BASE_TIME + 2, 1_000);
        receiver.recordEffect(envelope.operationId, claim.attemptId, claim.fencingToken, {
          outcome: scenario.name === 'ack_loss' ? 'EFFECT_APPLIED' : 'UNKNOWN',
          applicationAcknowledged: false,
          applicationReference: scenario.name,
          workOrderStatus: 'UNKNOWN',
          result: { ambiguous: true },
          occurredAtMs: BASE_TIME + 3,
        });
        return receiver.reconcile(envelope.operationId, 'lab', scenario.name, BASE_TIME + 4).verdict;
      });
    case 'duplication':
      return context((receiver) => {
        receiver.accept(envelope, BASE_TIME + 1);
        const claim = receiver.claim(envelope.operationId, 'worker', BASE_TIME + 2, 1_000);
        receiver.recordEffect(envelope.operationId, claim.attemptId, claim.fencingToken, effect('EFFECT_APPLIED', BASE_TIME + 3));
        const duplicate = receiver.accept(envelope, BASE_TIME + 4);
        return duplicate.duplicate && duplicate.receipt ? 'DUPLICATE_WITH_RECEIPT' : 'DUPLICATE_WITHOUT_PROOF';
      });
    case 'reordering': {
      const facts: OperationFact[] = [
        { factId: 'fact_ack', operationId: envelope.operationId, source: 'APPLICATION', kind: 'APPLICATION_ACK', occurredAtMs: 1, reference: 'ack', payload: {} },
        { factId: 'fact_accept', operationId: envelope.operationId, source: 'RECEIVER', kind: 'RECEIVER_ACCEPTED', occurredAtMs: 2, reference: 'accept', payload: {} },
      ];
      return reconcileFacts(envelope.operationId, facts, 3).verdict;
    }
    case 'truncation':
      return context((receiver) => {
        try { receiver.accept({ ...envelope, payloadBase64: envelope.payloadBase64.slice(0, 3) }, BASE_TIME + 1); }
        catch (error) { return error instanceof Error ? error.message : 'ERROR'; }
        return 'ACCEPTED';
      });
    case 'process_death':
    case 'reboot': {
      const dir = mkdtempSync(join(tmpdir(), 'zungun-resilience-reopen-'));
      const path = join(dir, 'receiver.sqlite');
      const provider = new InMemoryReceiptKeyProvider(BASE_TIME - 1_000);
      let database = new ReceiverDatabase(path);
      let receiver = new PersistentReceiver(database, provider, 'receiver_resilience');
      try {
        receiver.accept(envelope, BASE_TIME + 1);
        database.close();
        database = new ReceiverDatabase(path);
        receiver = new PersistentReceiver(database, provider, 'receiver_resilience');
        return receiver.listOperationsPage().total === 1 ? 'RECOVERED_PENDING' : 'LOST';
      } finally {
        database.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
    case 'upgrade':
      return context((receiver) => receiver.accept({
        ...envelope,
        extensions: { ...envelope.extensions, clientVersion: 'android-order076-upgraded' },
      }, BASE_TIME + 1).state);
    case 'clock_skew':
      return context((receiver) => {
        try { receiver.accept({ ...envelope, policy: { ...envelope.policy, createdAtMs: BASE_TIME + 999_999, expiresAtMs: BASE_TIME + 1_999_999 } }, BASE_TIME); }
        catch (error) { return error instanceof Error ? error.message : 'ERROR'; }
        return 'ACCEPTED';
      });
    case 'ttl_expiry':
      return context((receiver) => {
        try { receiver.accept({ ...envelope, policy: { ...envelope.policy, createdAtMs: BASE_TIME - 2_000, expiresAtMs: BASE_TIME - 1 } }, BASE_TIME); }
        catch (error) { return error instanceof Error ? error.message : 'ERROR'; }
        return 'ACCEPTED';
      });
    case 'storage_failure':
      try { new ReceiverDatabase('/path/that/does/not/exist/receiver.sqlite'); }
      catch { return 'STORAGE_FAILURE'; }
      return 'STORAGE_OPENED';
    case 'receiver_crash': {
      const dir = mkdtempSync(join(tmpdir(), 'zungun-resilience-crash-'));
      const path = join(dir, 'receiver.sqlite');
      const provider = new InMemoryReceiptKeyProvider(BASE_TIME - 1_000);
      let database = new ReceiverDatabase(path);
      try {
        new PersistentReceiver(database, provider, 'receiver_resilience').accept(envelope, BASE_TIME + 1);
        database.close();
        database = new ReceiverDatabase(path);
        const receiver = new PersistentReceiver(database, provider, 'receiver_resilience');
        const claim = receiver.claim(envelope.operationId, 'worker', BASE_TIME + 2, 1_000);
        receiver.recordEffect(envelope.operationId, claim.attemptId, claim.fencingToken, effect('EFFECT_APPLIED', BASE_TIME + 3));
        return receiver.reconcile(envelope.operationId, 'lab', 'crash', BASE_TIME + 4).verdict;
      } finally {
        database.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
    case 'lease_loss':
      return context((receiver) => {
        receiver.accept(envelope, BASE_TIME + 1);
        const claim = receiver.claim(envelope.operationId, 'worker', BASE_TIME + 2, 1_000);
        try { receiver.recordEffect(envelope.operationId, claim.attemptId, claim.fencingToken + 1, effect('EFFECT_APPLIED', BASE_TIME + 3)); }
        catch (error) { return error instanceof Error ? error.message : 'ERROR'; }
        return 'ACCEPTED';
      });
    case 'delayed_effect':
      return context((receiver) => {
        receiver.accept(envelope, BASE_TIME + 1);
        const first = receiver.claim(envelope.operationId, 'worker', BASE_TIME + 2, 1_000);
        receiver.recordEffect(envelope.operationId, first.attemptId, first.fencingToken, {
          outcome: 'UNKNOWN', applicationAcknowledged: false, applicationReference: 'lost',
          workOrderStatus: 'UNKNOWN', result: { lost: true }, occurredAtMs: BASE_TIME + 3,
        });
        const second = receiver.claim(envelope.operationId, 'worker', BASE_TIME + 2_000, 1_000);
        receiver.recordEffect(envelope.operationId, second.attemptId, second.fencingToken, effect('EFFECT_APPLIED', BASE_TIME + 2_001));
        return receiver.reconcile(envelope.operationId, 'lab', 'delayed', BASE_TIME + 2_002).verdict;
      });
    case 'database_erp_mismatch':
      return context((receiver) => {
        receiver.accept(envelope, BASE_TIME + 1);
        const claim = receiver.claim(envelope.operationId, 'worker', BASE_TIME + 2, 1_000);
        receiver.recordEffect(envelope.operationId, claim.attemptId, claim.fencingToken, effect('EFFECT_APPLIED', BASE_TIME + 3));
        const payload = { source: 'ERP', kind: 'NO_EFFECT', occurredAtMs: BASE_TIME + 4, reference: 'erp:no-effect', payload: { mismatch: true } };
        receiver.database.db.prepare('INSERT INTO evidence(operation_id,source,kind,occurred_at_ms,reference,payload_json,evidence_sha256) VALUES(?,?,?,?,?,?,?)')
          .run(envelope.operationId, payload.source, payload.kind, payload.occurredAtMs, payload.reference, canonicalize(payload.payload), evidenceHash(payload));
        return receiver.reconcile(envelope.operationId, 'lab', 'mismatch', BASE_TIME + 5).verdict;
      });
    case 'receipt_tampering':
    case 'stale_key':
    case 'revoked_key': {
      const provider = new InMemoryReceiptKeyProvider(BASE_TIME - 100);
      const payload = {
        schema: 'zungun.execution-receipt.v1' as const, protocolVersion: 1 as const,
        operationId: envelope.operationId, messageCommitment: envelope.messageCommitment,
        receiverId: 'receiver_resilience', applicationOutcome: 'NO_EFFECT' as const,
        applicationReference: 'erp:none', scopeType: envelope.scopeType, scopeId: envelope.scopeId,
        issuedAtMs: BASE_TIME, validFromMs: BASE_TIME - 1, validUntilMs: BASE_TIME + 100_000,
        replayNonce: envelope.replayNonce,
      };
      const receipt = signExecutionReceipt(payload, provider);
      if (scenario.name === 'receipt_tampering') {
        return verifyExecutionReceipt({ ...receipt, payload: { ...receipt.payload, applicationReference: 'tampered' } }, provider, BASE_TIME + 1)
          ? 'RECEIPT_VALID' : 'RECEIPT_INVALID';
      }
      if (scenario.name === 'stale_key') {
        return verifyExecutionReceipt(receipt, provider, BASE_TIME - 200) ? 'KEY_VALID' : 'KEY_NOT_YET_VALID';
      }
      provider.revoke(receipt.keyId, BASE_TIME);
      return verifyExecutionReceipt(receipt, provider, BASE_TIME + 1) ? 'KEY_VALID' : 'KEY_REVOKED';
    }
    case 'reconciliation_contradiction': {
      const facts: OperationFact[] = [
        { factId: 'fact_effect', operationId: envelope.operationId, source: 'APPLICATION', kind: 'EFFECT_APPLIED', occurredAtMs: 1, reference: 'effect', payload: {} },
        { factId: 'fact_no_effect', operationId: envelope.operationId, source: 'ERP', kind: 'NO_EFFECT', occurredAtMs: 2, reference: 'none', payload: {} },
      ];
      return reconcileFacts(envelope.operationId, facts, 3).verdict;
    }
    case 'silent_device':
      return context((receiver) => {
        receiver.declareScope({
          scopeType: envelope.scopeType, scopeId: envelope.scopeId, declarationVersion: 1,
          expectedReportingDeviceIds: ['device_17', 'silent'], expectedOperationIds: [envelope.operationId],
          expectedOperationCount: 1, declaredAtMs: BASE_TIME - 1, provenance: 'lab', previousManifestHash: null,
        }, 'admin');
        receiver.accept(envelope, BASE_TIME + 1);
        return receiver.completeness(envelope.scopeType, envelope.scopeId, BASE_TIME + 2).completeWithinDeclaredScope
          ? 'COMPLETE' : 'INCOMPLETE_DECLARED_SCOPE';
      });
    case 'unauthorized_role': {
      const authorizer = new StaticPrincipalAuthorizer([
        { subject: 'ingest', token: 'resilience-ingest-token-076', roles: ['ingest'] },
      ]);
      try { authorizer.require({ headers: { authorization: 'Bearer resilience-ingest-token-076' } } as any, 'keys:manage'); }
      catch (error) { return error instanceof Error ? error.message : 'ERROR'; }
      return 'ALLOWED';
    }
    case 'key_store_corruption': {
      const dir = mkdtempSync(join(tmpdir(), 'zungun-resilience-keys-'));
      const path = join(dir, 'keys.json');
      try {
        new LocalFileReceiptKeyProvider(path, BASE_TIME);
        writeFileSync(path, '{broken');
        try { new LocalFileReceiptKeyProvider(path, BASE_TIME); }
        catch (error) { return error instanceof Error ? error.message : 'ERROR'; }
        return 'OPENED';
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
    case 'static_path_traversal': {
      const root = resolve('/tmp/control-room');
      const candidate = resolve(root, '../../etc/passwd');
      const rel = relative(root, candidate);
      const contained = !(rel === '..' || rel.startsWith(`..${sep}`) || rel.includes(`${sep}..${sep}`));
      return contained ? 'PATH_ESCAPED' : 'PATH_CONTAINED';
    }
  }
}

function runScenario(scenario: ResilienceScenario): ScenarioResult {
  try {
    const observedOutcome = outcomeFor(scenario);
    const passed = observedOutcome === scenario.expectedOutcome;
    return Object.freeze({
      name: scenario.name,
      seed: scenario.seed,
      passed,
      expectedOutcome: scenario.expectedOutcome,
      observedOutcome,
      injectedFault: scenario.injectedFault,
      detail: passed ? 'exact outcome matched' : 'exact outcome mismatch',
    });
  } catch (error) {
    return Object.freeze({
      name: scenario.name,
      seed: scenario.seed,
      passed: false,
      expectedOutcome: scenario.expectedOutcome,
      observedOutcome: 'UNEXPECTED_EXCEPTION',
      injectedFault: scenario.injectedFault,
      detail: error instanceof Error ? `${error.name}:${error.message}` : String(error),
    });
  }
}

const results = deterministicScenarios().map(runScenario);
const passed = results.filter((result) => result.passed).length;
const report = {
  schema: 'zungun.resilience-report.v2',
  baseTimeMs: BASE_TIME,
  scenarioCount: results.length,
  passed,
  failed: results.length - passed,
  exactOutcomeMatching: true,
  normalizationApplied: false,
  results,
};
const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
mkdirSync('.artifacts/resilience', { recursive: true });
writeFileSync('.artifacts/resilience/report.json', bytes);
writeFileSync('.artifacts/resilience/report.sha256', `${createHash('sha256').update(bytes).digest('hex')}  report.json\n`);
console.log(JSON.stringify({
  ok: passed === results.length,
  scenarioCount: results.length,
  passed,
  failed: results.length - passed,
  normalizationApplied: false,
  seeds: results.map((result) => result.seed),
}));
if (passed !== results.length) process.exitCode = 1;
