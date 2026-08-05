import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stableOperationId, type OperationEnvelope } from '../packages/protocol-core/src/operation.js';
import { InMemoryReceiptKeyProvider } from '../packages/security/src/receipts.js';
import { ReceiverDatabase } from '../services/receiver/src/database.js';
import { PersistentReceiver } from '../services/receiver/src/receiver.js';

export const BASE_TIME = 1_750_000_000_000;
export function makeEnvelope(overrides: Partial<OperationEnvelope> = {}): OperationEnvelope {
  const createdAtMs = overrides.policy?.createdAtMs ?? BASE_TIME;
  const operationId = overrides.operationId ?? stableOperationId({tenantId:'tenant_demo',deviceId:'device_17',localSequence:1,createdAtMs});
  const base: OperationEnvelope = {
    protocol:'zungun.operation.v1',wireVersion:1,operationId,idempotencyKey:`idem_${operationId}`,tenantId:'tenant_demo',scopeType:'SHIFT',scopeId:'shift_2026_08_05',workOrderId:'WO-2841',messageId:'msg_2841',messageCommitment:'sha256:message_commitment_2841',payloadBase64:Buffer.from(JSON.stringify({action:'COMPLETE',notes:'pump inspected'})).toString('base64'),contentType:'application/json',
    policy:{priority:2,createdAtMs,expiresAtMs:createdAtMs+3_600_000,retryBudget:5,cancellationAllowed:true,semanticRevalidationRequired:true,maxPayloadBytes:16_384},replayNonce:`nonce_${operationId}`,extensions:{deviceId:'device_17',clientVersion:'android-order075'},
  };
  return { ...base, ...overrides, policy:{...base.policy,...(overrides.policy??{})}, extensions:{...base.extensions,...(overrides.extensions??{})} };
}
export function withReceiver<T>(fn:(context:{receiver:PersistentReceiver;provider:InMemoryReceiptKeyProvider;dir:string})=>T):T {
  const dir=mkdtempSync(join(tmpdir(),'zungun-test-'));const db=new ReceiverDatabase(join(dir,'receiver.sqlite'));const provider=new InMemoryReceiptKeyProvider(BASE_TIME-1000,365*24*60*60*1000);const receiver=new PersistentReceiver(db,provider,'receiver_test');
  try{return fn({receiver,provider,dir});}finally{db.close();rmSync(dir,{recursive:true,force:true});}
}
