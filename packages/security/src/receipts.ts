import { createHash, createPrivateKey, createPublicKey, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalize, sha256Hex, type CanonicalValue } from '../../protocol-core/src/canonical.js';
import type { ApplicationOutcome } from '../../protocol-core/src/operation.js';

export const RECEIPT_SCHEMA = 'zungun.execution-receipt.v1' as const;
export const RECEIPT_ALGORITHM = 'ECDSA_P256_SHA256' as const;

export interface ExecutionReceiptPayload {
  readonly schema: typeof RECEIPT_SCHEMA;
  readonly protocolVersion: 1;
  readonly operationId: string;
  readonly messageCommitment: string;
  readonly receiverId: string;
  readonly applicationOutcome: Exclude<ApplicationOutcome, 'DUPLICATE' | 'COMPENSATION_REQUIRED'>;
  readonly applicationReference: string;
  readonly scopeType: 'ROUTE' | 'SHIFT' | 'DEVICE' | 'BATCH';
  readonly scopeId: string;
  readonly issuedAtMs: number;
  readonly validFromMs: number;
  readonly validUntilMs: number;
  readonly replayNonce: string;
}

export interface SignedExecutionReceipt {
  readonly payload: ExecutionReceiptPayload;
  readonly keyId: string;
  readonly algorithm: typeof RECEIPT_ALGORITHM;
  readonly signatureBase64: string;
  readonly payloadSha256: string;
}

export interface PublicKeyRecord {
  readonly keyId: string;
  readonly algorithm: typeof RECEIPT_ALGORITHM;
  readonly publicKeyPem: string;
  readonly validFromMs: number;
  readonly validUntilMs: number;
  readonly revokedAtMs: number | null;
}

export interface ReceiptKeyProvider {
  current(nowMs: number): { readonly keyId: string; readonly privateKeyPem: string; readonly publicRecord: PublicKeyRecord };
  resolve(keyId: string): PublicKeyRecord | null;
  revoke(keyId: string, atMs: number): void;
}

function payloadValue(payload: ExecutionReceiptPayload): CanonicalValue {
  return {
    schema: payload.schema,
    protocolVersion: payload.protocolVersion,
    operationId: payload.operationId,
    messageCommitment: payload.messageCommitment,
    receiverId: payload.receiverId,
    applicationOutcome: payload.applicationOutcome,
    applicationReference: payload.applicationReference,
    scopeType: payload.scopeType,
    scopeId: payload.scopeId,
    issuedAtMs: payload.issuedAtMs,
    validFromMs: payload.validFromMs,
    validUntilMs: payload.validUntilMs,
    replayNonce: payload.replayNonce,
  };
}

export function signExecutionReceipt(payload: ExecutionReceiptPayload, provider: ReceiptKeyProvider): SignedExecutionReceipt {
  validateReceiptPayload(payload);
  const key = provider.current(payload.issuedAtMs);
  const canonical = canonicalize(payloadValue(payload));
  const signer = createSign('SHA256');
  signer.update(canonical);
  signer.end();
  const signatureBase64 = signer.sign(createPrivateKey(key.privateKeyPem)).toString('base64');
  return Object.freeze({ payload: Object.freeze({ ...payload }), keyId: key.keyId, algorithm: RECEIPT_ALGORITHM, signatureBase64, payloadSha256: sha256Hex(canonical) });
}

export function verifyExecutionReceipt(receipt: SignedExecutionReceipt, provider: Pick<ReceiptKeyProvider, 'resolve'>, nowMs: number): boolean {
  try {
    validateReceiptPayload(receipt.payload);
    if (receipt.algorithm !== RECEIPT_ALGORITHM) return false;
    const key = provider.resolve(receipt.keyId);
    if (!key || key.algorithm !== RECEIPT_ALGORITHM || key.revokedAtMs !== null && key.revokedAtMs <= nowMs) return false;
    if (nowMs < key.validFromMs || nowMs > key.validUntilMs || nowMs < receipt.payload.validFromMs || nowMs > receipt.payload.validUntilMs) return false;
    const canonical = canonicalize(payloadValue(receipt.payload));
    if (receipt.payloadSha256 !== sha256Hex(canonical)) return false;
    const verifier = createVerify('SHA256');
    verifier.update(canonical);
    verifier.end();
    return verifier.verify(createPublicKey(key.publicKeyPem), Buffer.from(receipt.signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

export function receiptVectorHash(receipt: SignedExecutionReceipt): string {
  return createHash('sha256').update(canonicalize({
    payload: payloadValue(receipt.payload), keyId: receipt.keyId, algorithm: receipt.algorithm,
    signatureBase64: receipt.signatureBase64, payloadSha256: receipt.payloadSha256,
  })).digest('hex');
}

export function validateReceiptPayload(payload: ExecutionReceiptPayload): void {
  if (payload.schema !== RECEIPT_SCHEMA || payload.protocolVersion !== 1) throw new Error('invalid receipt version');
  for (const key of ['operationId','messageCommitment','receiverId','applicationReference','scopeId','replayNonce'] as const) {
    if (!/^[A-Za-z0-9._:+/-]{1,256}$/.test(payload[key])) throw new Error(`invalid ${key}`);
  }
  if (!['EFFECT_APPLIED','NO_EFFECT','REJECTED','UNKNOWN'].includes(payload.applicationOutcome)) throw new Error('invalid application outcome');
  if (!['ROUTE','SHIFT','DEVICE','BATCH'].includes(payload.scopeType)) throw new Error('invalid scope');
  if (![payload.issuedAtMs,payload.validFromMs,payload.validUntilMs].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error('invalid receipt timestamp');
  if (payload.validFromMs > payload.issuedAtMs || payload.issuedAtMs >= payload.validUntilMs) throw new Error('invalid receipt validity');
}

export class InMemoryReceiptKeyProvider implements ReceiptKeyProvider {
  private readonly records = new Map<string, { privateKeyPem: string; publicRecord: PublicKeyRecord }>();
  private activeKeyId: string;
  constructor(nowMs = 1_700_000_000_000, validityMs = 365 * 24 * 60 * 60 * 1000) {
    this.activeKeyId = this.rotate(nowMs, validityMs);
  }
  rotate(nowMs: number, validityMs: number): string {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const keyId = `key_${sha256Hex(publicKeyPem).slice(0, 24)}`;
    const publicRecord: PublicKeyRecord = Object.freeze({ keyId, algorithm: RECEIPT_ALGORITHM, publicKeyPem, validFromMs: nowMs, validUntilMs: nowMs + validityMs, revokedAtMs: null });
    this.records.set(keyId, { privateKeyPem, publicRecord });
    this.activeKeyId = keyId;
    return keyId;
  }
  current(nowMs: number) {
    const record = this.records.get(this.activeKeyId);
    if (!record || nowMs < record.publicRecord.validFromMs || nowMs > record.publicRecord.validUntilMs) throw new Error('no active signing key');
    return { keyId: this.activeKeyId, privateKeyPem: record.privateKeyPem, publicRecord: record.publicRecord };
  }
  resolve(keyId: string) { return this.records.get(keyId)?.publicRecord ?? null; }
  revoke(keyId: string, atMs: number): void {
    const record = this.records.get(keyId); if (!record) throw new Error('unknown key');
    this.records.set(keyId, { ...record, publicRecord: Object.freeze({ ...record.publicRecord, revokedAtMs: atMs }) });
  }
}

export class LocalFileReceiptKeyProvider implements ReceiptKeyProvider {
  private readonly memory: InMemoryReceiptKeyProvider;
  constructor(private readonly path: string, nowMs = Date.now()) {
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      const generated = new InMemoryReceiptKeyProvider(nowMs);
      const current = generated.current(nowMs);
      writeFileSync(path, JSON.stringify({ keyId: current.keyId, privateKeyPem: current.privateKeyPem, publicRecord: current.publicRecord }, null, 2), { mode: 0o600 });
      chmodSync(path, 0o600);
    }
    const stored = JSON.parse(readFileSync(path, 'utf8')) as { keyId: string; privateKeyPem: string; publicRecord: PublicKeyRecord };
    this.memory = new InMemoryReceiptKeyProvider(nowMs);
    (this.memory as any).records = new Map([[stored.keyId, { privateKeyPem: stored.privateKeyPem, publicRecord: Object.freeze(stored.publicRecord) }]]);
    (this.memory as any).activeKeyId = stored.keyId;
  }
  current(nowMs: number) { return this.memory.current(nowMs); }
  resolve(keyId: string) { return this.memory.resolve(keyId); }
  revoke(keyId: string, atMs: number) { this.memory.revoke(keyId, atMs); }
}
