import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendWitnessEvidence,
  reconcileWitnessHistories,
  verifyWitnessChain,
  type WitnessEvidence,
  type WitnessEvidenceInput,
} from '../../../packages/protocol-core/src/witness.js';
import { InMemoryReceiptKeyProvider } from '../../../packages/security/src/receipts.js';
import { ReceiverDatabase } from '../../../services/receiver/src/database.js';
import { PersistentReceiver } from '../../../services/receiver/src/receiver.js';
import { WitnessReceiver } from '../../../services/receiver/src/witness.js';
import { BASE_TIME, makeEnvelope } from '../../../tests/helpers.js';

export interface BlackoutScenarioResult {
  readonly name: string;
  readonly passed: boolean;
  readonly expected: string;
  readonly observed: string;
  readonly detail: string;
}

export interface BlackoutDrillReport {
  readonly schema: 'zungun.blackout-drill.v1';
  readonly baseTimeMs: number;
  readonly scenarioCount: number;
  readonly passed: number;
  readonly failed: number;
  readonly results: readonly BlackoutScenarioResult[];
}

function append(chain: WitnessEvidence[], input: WitnessEvidenceInput): WitnessEvidence {
  const item = appendWitnessEvidence(chain, input);
  chain.push(item);
  return item;
}

function senderChain(
  incidentId: string,
  transportKind: 'HTTP_WEBHOOK' | 'STORE_FORWARD' = 'HTTP_WEBHOOK',
  routeId = 'route:primary',
): WitnessEvidence[] {
  const chain: WitnessEvidence[] = [];
  append(chain, {
    incidentId,
    evidenceId: `${incidentId}:detected`,
    state: 'DETECTED',
    evidenceClass: 'OBSERVED_FACT',
    emitterId: 'sensor:blackout',
    authorizationScope: 'witness:source',
    observedAtMs: BASE_TIME,
    monotonicMs: 1,
    provenance: 'sensor:synthetic',
    reasonCode: 'SYNTHETIC_DETECTION',
    claims: { boundaryRole: 'SENSOR_OR_SOURCE', sourceId: 'sensor:blackout' },
  });
  append(chain, {
    incidentId,
    evidenceId: `${incidentId}:local`,
    state: 'COMMITTED_LOCAL',
    evidenceClass: 'MACHINE_ASSERTION',
    emitterId: 'android:blackout',
    authorizationScope: 'witness:local',
    observedAtMs: BASE_TIME + 1,
    monotonicMs: 2,
    provenance: 'android:room',
    reasonCode: 'LOCAL_DURABLE_COMMIT',
    claims: { boundaryRole: 'ZUNGUN_WITNESS', localCommitRef: `room:${incidentId}` },
  });
  append(chain, {
    incidentId,
    evidenceId: `${incidentId}:custody`,
    state: 'CUSTODY_ACCEPTED',
    evidenceClass: 'MACHINE_ASSERTION',
    emitterId: `transport:${transportKind.toLowerCase()}`,
    authorizationScope: 'witness:transport',
    observedAtMs: BASE_TIME + 2,
    monotonicMs: 3,
    provenance: `transport:${transportKind.toLowerCase()}`,
    reasonCode: transportKind === 'STORE_FORWARD' ? 'ALTERNATE_STORE_FORWARD_CUSTODY' : 'PRIMARY_HTTP_CUSTODY',
    claims: {
      boundaryRole: 'TRANSPORT',
      transportKind,
      routeId,
      custodyRef: `custody:${routeId}`,
    },
  });
  return chain;
}

function partialSender(incidentId: string): WitnessEvidence[] {
  return senderChain(incidentId).slice(0, 2);
}

function attestation(
  incidentId: string,
  evidenceId: string,
  state: 'OWNED_BY_RESPONDER' | 'ACTION_STARTED' | 'CONDITION_RECHECKED' | 'RESOLVED' | 'UNKNOWN' | 'EXPIRED_WITHOUT_RESOLUTION',
  monotonicMs: number,
): WitnessEvidenceInput {
  const base = {
    incidentId,
    evidenceId,
    state,
    authorizationScope: 'witness:attest',
    observedAtMs: BASE_TIME + monotonicMs,
    monotonicMs,
  } as const;
  switch (state) {
    case 'OWNED_BY_RESPONDER': return { ...base, evidenceClass: 'HUMAN_ATTESTATION', emitterId: 'responder:ops', provenance: 'responder:blackout', reasonCode: 'RESPONDER_OWNED', claims: { boundaryRole: 'RESPONDER', responderId: 'ops', ownershipRef: `ownership:${incidentId}` } };
    case 'ACTION_STARTED': return { ...base, evidenceClass: 'HUMAN_ATTESTATION', emitterId: 'responder:ops', provenance: 'responder:blackout', reasonCode: 'ACTION_STARTED', claims: { boundaryRole: 'RESPONDER', actionRef: `action:${incidentId}` } };
    case 'CONDITION_RECHECKED': return { ...base, evidenceClass: 'OBSERVED_FACT', emitterId: 'sensor:blackout', provenance: 'sensor:blackout', reasonCode: 'CONDITION_RECHECKED', claims: { boundaryRole: 'SENSOR_OR_SOURCE', recheckRef: `recheck:${incidentId}`, conditionStatus: 'CLEARED' } };
    case 'RESOLVED': return { ...base, evidenceClass: 'HUMAN_ATTESTATION', emitterId: 'responder:ops', provenance: 'responder:blackout', reasonCode: 'RESOLUTION_ATTESTED', claims: { boundaryRole: 'RESPONDER', resolutionRef: `resolution:${incidentId}` } };
    case 'UNKNOWN': return { ...base, evidenceClass: 'DERIVED_CONCLUSION', emitterId: 'reconciler:blackout', provenance: 'reconciler:blackout', reasonCode: 'UNRECOVERABLE_AMBIGUITY', claims: { unknownReason: 'NO_ADDITIONAL_EVIDENCE' } };
    case 'EXPIRED_WITHOUT_RESOLUTION': return { ...base, evidenceClass: 'DERIVED_CONCLUSION', emitterId: 'reconciler:blackout', provenance: 'reconciler:blackout', reasonCode: 'EVIDENCE_WINDOW_EXPIRED', claims: { expiresAtMs: BASE_TIME + monotonicMs } };
  }
}

function withReceiver<T>(suffix: string, operation: (ctx: {
  db: ReceiverDatabase;
  receiver: PersistentReceiver;
  witness: WitnessReceiver;
  path: string;
  dir: string;
  operationId: string;
}) => T): T {
  const dir = mkdtempSync(join(tmpdir(), `zungun-blackout-${suffix}-`));
  const path = join(dir, 'receiver.sqlite');
  const operationId = `op_blackout_${suffix}`;
  const db = new ReceiverDatabase(path);
  const receiver = new PersistentReceiver(db, new InMemoryReceiptKeyProvider(BASE_TIME - 1_000), 'receiver_blackout');
  const witness = new WitnessReceiver(db, 'receiver_blackout');
  receiver.accept(makeEnvelope({ operationId, idempotencyKey: `idem_${operationId}`, messageId: `msg_${operationId}`, replayNonce: `nonce_${operationId}`, workOrderId: `WO-${suffix}` }), BASE_TIME + 10);
  try {
    return operation({ db, receiver, witness, path, dir, operationId });
  } finally {
    try { db.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}

function scenario(name: string, expected: string, operation: () => string): BlackoutScenarioResult {
  try {
    const observed = operation();
    return Object.freeze({ name, expected, observed, passed: observed === expected, detail: observed === expected ? 'exact outcome matched' : 'exact outcome mismatch' });
  } catch (error) {
    const observed = error instanceof Error ? error.message : String(error);
    return Object.freeze({ name, expected, observed, passed: observed === expected, detail: observed === expected ? 'expected fail-closed outcome matched' : 'unexpected exception' });
  }
}

export function runIntegratedBlackoutDrill(): BlackoutDrillReport {
  const results: BlackoutScenarioResult[] = [];

  results.push(scenario('synthetic_detection', 'DETECTED', () => {
    const chain = partialSender('op_blackout_detection');
    verifyWitnessChain(chain);
    return chain[0]!.state;
  }));

  results.push(scenario('primary_network_loss', 'WITNESS_CUSTODY_REQUIRED', () => withReceiver('network_loss', ({ witness, operationId }) => {
    witness.ingestSender(operationId, partialSender(operationId), BASE_TIME + 20);
    return 'UNEXPECTED_DELIVERY';
  })));

  results.push(scenario('alternate_store_forward_custody', 'DELIVERED_DURABLY', () => withReceiver('store_forward', ({ witness, operationId }) => {
    return witness.ingestSender(operationId, senderChain(operationId, 'STORE_FORWARD', 'route:alternate'), BASE_TIME + 20).at(-1)!.state;
  })));

  results.push(scenario('sender_receiver_restart', 'RECOVERED_EXACT_CHAIN', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zungun-blackout-restart-'));
    const path = join(dir, 'receiver.sqlite');
    const operationId = 'op_blackout_restart';
    const provider = new InMemoryReceiptKeyProvider(BASE_TIME - 1_000);
    let db = new ReceiverDatabase(path);
    let receiver = new PersistentReceiver(db, provider, 'receiver_blackout');
    receiver.accept(makeEnvelope({ operationId, idempotencyKey: `idem_${operationId}`, messageId: `msg_${operationId}`, replayNonce: `nonce_${operationId}`, workOrderId: 'WO-restart' }), BASE_TIME + 10);
    let witness = new WitnessReceiver(db, 'receiver_blackout');
    const before = witness.ingestSender(operationId, senderChain(operationId, 'STORE_FORWARD', 'route:alternate'), BASE_TIME + 20).map((item) => item.evidenceHash);
    db.close();
    db = new ReceiverDatabase(path); db.migrate(); receiver = new PersistentReceiver(db, provider, 'receiver_blackout'); witness = new WitnessReceiver(db, 'receiver_blackout');
    const after = witness.chain(operationId).map((item) => item.evidenceHash);
    db.close(); rmSync(dir, { recursive: true, force: true });
    return JSON.stringify(before) === JSON.stringify(after) ? 'RECOVERED_EXACT_CHAIN' : 'CHAIN_CHANGED';
  }));

  results.push(scenario('duplicate_delivery', 'IDEMPOTENT_DUPLICATE', () => withReceiver('duplicate', ({ witness, operationId }) => {
    const sender = senderChain(operationId);
    const first = witness.ingestSender(operationId, sender, BASE_TIME + 20);
    const second = witness.ingestSender(operationId, sender, BASE_TIME + 21);
    return JSON.stringify(first.map((item) => item.evidenceHash)) === JSON.stringify(second.map((item) => item.evidenceHash)) ? 'IDEMPOTENT_DUPLICATE' : 'DUPLICATED_EVIDENCE';
  })));

  results.push(scenario('delayed_delivery', 'DELIVERED_DURABLY', () => withReceiver('delayed', ({ witness, operationId }) => {
    return witness.ingestSender(operationId, senderChain(operationId, 'STORE_FORWARD', 'route:delayed'), BASE_TIME + 86_400_000).at(-1)!.state;
  })));

  results.push(scenario('out_of_order_evidence', 'WITNESS_CHAIN_POSITION_INVALID', () => withReceiver('out_of_order', ({ witness, operationId }) => {
    const chain = senderChain(operationId);
    witness.ingestSender(operationId, [chain[1], chain[0], chain[2]], BASE_TIME + 20);
    return 'UNEXPECTED_ACCEPT';
  })));

  results.push(scenario('ownership_without_action', 'OWNED_BY_RESPONDER', () => withReceiver('ownership', ({ witness, operationId }) => {
    witness.ingestSender(operationId, senderChain(operationId), BASE_TIME + 20);
    witness.attest(operationId, attestation(operationId, `${operationId}:owned`, 'OWNED_BY_RESPONDER', 5), 'ops', BASE_TIME + 30);
    return witness.chain(operationId).at(-1)!.state;
  })));

  results.push(scenario('action_without_recheck', 'ACTION_STARTED_NOT_RESOLVED', () => withReceiver('action', ({ witness, operationId }) => {
    witness.ingestSender(operationId, senderChain(operationId), BASE_TIME + 20);
    witness.attest(operationId, attestation(operationId, `${operationId}:owned`, 'OWNED_BY_RESPONDER', 5), 'ops', BASE_TIME + 30);
    witness.attest(operationId, attestation(operationId, `${operationId}:action`, 'ACTION_STARTED', 6), 'ops', BASE_TIME + 31);
    try {
      witness.attest(operationId, attestation(operationId, `${operationId}:resolved`, 'RESOLVED', 7), 'ops', BASE_TIME + 32);
      return 'UNEXPECTED_RESOLVED';
    } catch {
      return witness.chain(operationId).at(-1)!.state === 'ACTION_STARTED' ? 'ACTION_STARTED_NOT_RESOLVED' : 'WRONG_STATE';
    }
  })));

  results.push(scenario('conflicting_history', 'CONFLICT', () => withReceiver('conflict', ({ witness, operationId }) => {
    const primary = senderChain(operationId, 'HTTP_WEBHOOK', 'route:primary');
    witness.ingestSender(operationId, primary, BASE_TIME + 20);
    const alternate = senderChain(operationId, 'STORE_FORWARD', 'route:alternate');
    return reconcileWitnessHistories(alternate, witness.chain(operationId)).state;
  })));

  results.push(scenario('expiry_without_resolution', 'EXPIRED_WITHOUT_RESOLUTION', () => withReceiver('expiry', ({ witness, operationId }) => {
    witness.ingestSender(operationId, senderChain(operationId), BASE_TIME + 20);
    witness.attest(operationId, attestation(operationId, `${operationId}:expired`, 'EXPIRED_WITHOUT_RESOLUTION', 5), 'reviewer', BASE_TIME + 30);
    return witness.chain(operationId).at(-1)!.state;
  })));

  results.push(scenario('eventual_reconciliation', 'RECEIVER_DURABLE_EVIDENCE_RECOVERED', () => withReceiver('reconcile', ({ witness, operationId }) => {
    const sender = senderChain(operationId, 'STORE_FORWARD', 'route:alternate');
    witness.ingestSender(operationId, sender, BASE_TIME + 20);
    return witness.reconcile(operationId, sender).code;
  })));

  results.push(scenario('unrecoverable_unknown', 'UNKNOWN', () => withReceiver('unknown', ({ witness, operationId }) => {
    witness.ingestSender(operationId, senderChain(operationId), BASE_TIME + 20);
    witness.attest(operationId, attestation(operationId, `${operationId}:unknown`, 'UNKNOWN', 5), 'reviewer', BASE_TIME + 30);
    return witness.reconcile(operationId, witness.chain(operationId)).state;
  })));

  const passed = results.filter((item) => item.passed).length;
  return Object.freeze({
    schema: 'zungun.blackout-drill.v1',
    baseTimeMs: BASE_TIME,
    scenarioCount: results.length,
    passed,
    failed: results.length - passed,
    results: Object.freeze(results),
  });
}
