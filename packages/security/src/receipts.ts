import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
  current(nowMs: number): {
    readonly keyId: string;
    readonly privateKeyPem: string;
    readonly publicRecord: PublicKeyRecord;
  };
  resolve(keyId: string): PublicKeyRecord | null;
  revoke(keyId: string, atMs: number): void;
}

export interface RotatingReceiptKeyProvider extends ReceiptKeyProvider {
  rotate(nowMs: number, validityMs: number): string;
  list(): readonly PublicKeyRecord[];
}

export interface ReceiptBindingExpectation {
  readonly operationId: string;
  readonly messageCommitment: string;
  readonly receiverId: string;
  readonly scopeType: ExecutionReceiptPayload['scopeType'];
  readonly scopeId: string;
  readonly replayNonce: string;
  readonly allowedOutcomes?: readonly ExecutionReceiptPayload['applicationOutcome'][];
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

export function receiptCanonicalJson(payload: ExecutionReceiptPayload): string {
  validateReceiptPayload(payload);
  return canonicalize(payloadValue(payload));
}

export function signExecutionReceipt(
  payload: ExecutionReceiptPayload,
  provider: ReceiptKeyProvider,
): SignedExecutionReceipt {
  validateReceiptPayload(payload);
  const key = provider.current(payload.issuedAtMs);
  const canonical = receiptCanonicalJson(payload);
  const signer = createSign('SHA256');
  signer.update(canonical);
  signer.end();
  const signatureBase64 = signer.sign(createPrivateKey(key.privateKeyPem)).toString('base64');
  return Object.freeze({
    payload: Object.freeze({ ...payload }),
    keyId: key.keyId,
    algorithm: RECEIPT_ALGORITHM,
    signatureBase64,
    payloadSha256: sha256Hex(canonical),
  });
}

export function verifyExecutionReceipt(
  receipt: SignedExecutionReceipt,
  provider: Pick<ReceiptKeyProvider, 'resolve'>,
  nowMs: number,
): boolean {
  try {
    validateReceiptPayload(receipt.payload);
    if (receipt.algorithm !== RECEIPT_ALGORITHM) return false;
    const key = provider.resolve(receipt.keyId);
    if (!key || key.algorithm !== RECEIPT_ALGORITHM) return false;
    if (key.revokedAtMs !== null && key.revokedAtMs <= nowMs) return false;
    if (nowMs < key.validFromMs || nowMs > key.validUntilMs) return false;
    if (nowMs < receipt.payload.validFromMs || nowMs > receipt.payload.validUntilMs) return false;
    const canonical = receiptCanonicalJson(receipt.payload);
    if (receipt.payloadSha256 !== sha256Hex(canonical)) return false;
    const verifier = createVerify('SHA256');
    verifier.update(canonical);
    verifier.end();
    return verifier.verify(
      createPublicKey(key.publicKeyPem),
      Buffer.from(receipt.signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
}

export function verifyExecutionReceiptBinding(
  receipt: SignedExecutionReceipt,
  provider: Pick<ReceiptKeyProvider, 'resolve'>,
  nowMs: number,
  expected: ReceiptBindingExpectation,
): boolean {
  if (!verifyExecutionReceipt(receipt, provider, nowMs)) return false;
  const payload = receipt.payload;
  if (payload.operationId !== expected.operationId) return false;
  if (payload.messageCommitment !== expected.messageCommitment) return false;
  if (payload.receiverId !== expected.receiverId) return false;
  if (payload.scopeType !== expected.scopeType || payload.scopeId !== expected.scopeId) return false;
  if (payload.replayNonce !== expected.replayNonce) return false;
  if (expected.allowedOutcomes && !expected.allowedOutcomes.includes(payload.applicationOutcome)) return false;
  return true;
}

export function receiptVectorHash(receipt: SignedExecutionReceipt): string {
  return createHash('sha256').update(canonicalize({
    payload: payloadValue(receipt.payload),
    keyId: receipt.keyId,
    algorithm: receipt.algorithm,
    signatureBase64: receipt.signatureBase64,
    payloadSha256: receipt.payloadSha256,
  })).digest('hex');
}

export function validateReceiptPayload(payload: ExecutionReceiptPayload): void {
  if (payload.schema !== RECEIPT_SCHEMA || payload.protocolVersion !== 1) {
    throw new Error('invalid receipt version');
  }
  for (const key of [
    'operationId',
    'messageCommitment',
    'receiverId',
    'applicationReference',
    'scopeId',
    'replayNonce',
  ] as const) {
    if (!/^[A-Za-z0-9._:+/-]{1,256}$/.test(payload[key])) throw new Error(`invalid ${key}`);
  }
  if (!['EFFECT_APPLIED', 'NO_EFFECT', 'REJECTED', 'UNKNOWN'].includes(payload.applicationOutcome)) {
    throw new Error('invalid application outcome');
  }
  if (!['ROUTE', 'SHIFT', 'DEVICE', 'BATCH'].includes(payload.scopeType)) throw new Error('invalid scope');
  if (![payload.issuedAtMs, payload.validFromMs, payload.validUntilMs].every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  )) throw new Error('invalid receipt timestamp');
  if (payload.validFromMs > payload.issuedAtMs || payload.issuedAtMs >= payload.validUntilMs) {
    throw new Error('invalid receipt validity');
  }
}

interface PrivateKeyRecord {
  readonly privateKeyPem: string;
  readonly publicRecord: PublicKeyRecord;
}

function generateRecord(nowMs: number, validityMs: number): PrivateKeyRecord {
  if (!Number.isSafeInteger(validityMs) || validityMs < 1) throw new Error('invalid key validity');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const keyId = `key_${sha256Hex(publicKeyPem).slice(0, 24)}`;
  return Object.freeze({
    privateKeyPem,
    publicRecord: Object.freeze({
      keyId,
      algorithm: RECEIPT_ALGORITHM,
      publicKeyPem,
      validFromMs: nowMs,
      validUntilMs: nowMs + validityMs,
      revokedAtMs: null,
    }),
  });
}

export class InMemoryReceiptKeyProvider implements RotatingReceiptKeyProvider {
  private readonly records = new Map<string, PrivateKeyRecord>();
  private activeKeyId: string;

  constructor(nowMs = 1_700_000_000_000, validityMs = 365 * 24 * 60 * 60 * 1000) {
    const record = generateRecord(nowMs, validityMs);
    this.records.set(record.publicRecord.keyId, record);
    this.activeKeyId = record.publicRecord.keyId;
  }

  rotate(nowMs: number, validityMs: number): string {
    const record = generateRecord(nowMs, validityMs);
    this.records.set(record.publicRecord.keyId, record);
    this.activeKeyId = record.publicRecord.keyId;
    return this.activeKeyId;
  }

  current(nowMs: number) {
    const record = this.records.get(this.activeKeyId);
    if (!record) throw new Error('no active signing key');
    if (record.publicRecord.revokedAtMs !== null && record.publicRecord.revokedAtMs <= nowMs) {
      throw new Error('active signing key revoked');
    }
    if (nowMs < record.publicRecord.validFromMs || nowMs > record.publicRecord.validUntilMs) {
      throw new Error('no active signing key');
    }
    return Object.freeze({
      keyId: this.activeKeyId,
      privateKeyPem: record.privateKeyPem,
      publicRecord: record.publicRecord,
    });
  }

  resolve(keyId: string): PublicKeyRecord | null {
    return this.records.get(keyId)?.publicRecord ?? null;
  }

  revoke(keyId: string, atMs: number): void {
    const record = this.records.get(keyId);
    if (!record) throw new Error('unknown key');
    this.records.set(keyId, Object.freeze({
      privateKeyPem: record.privateKeyPem,
      publicRecord: Object.freeze({ ...record.publicRecord, revokedAtMs: atMs }),
    }));
  }

  list(): readonly PublicKeyRecord[] {
    return Object.freeze([...this.records.values()].map((record) => record.publicRecord)
      .sort((a, b) => a.validFromMs - b.validFromMs || a.keyId.localeCompare(b.keyId)));
  }
}

interface FileKeyState {
  readonly schema: 'zungun.receipt-key-store.v1';
  readonly revision: number;
  readonly activeKeyId: string;
  readonly records: readonly {
    readonly privateKeyPem: string;
    readonly publicRecord: PublicKeyRecord;
  }[];
}

function parseFileState(text: string): FileKeyState {
  let raw: Partial<FileKeyState>;
  try { raw = JSON.parse(text) as Partial<FileKeyState>; } catch { throw new Error('KEY_STORE_CORRUPT'); }
  if (raw.schema !== 'zungun.receipt-key-store.v1') throw new Error('KEY_STORE_CORRUPT');
  if (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1) throw new Error('KEY_STORE_CORRUPT');
  if (typeof raw.activeKeyId !== 'string' || !Array.isArray(raw.records) || raw.records.length < 1) {
    throw new Error('KEY_STORE_CORRUPT');
  }
  const records = raw.records.map((record) => {
    if (!record || typeof record.privateKeyPem !== 'string' || !record.publicRecord) {
      throw new Error('KEY_STORE_CORRUPT');
    }
    const publicRecord = record.publicRecord;
    if (publicRecord.algorithm !== RECEIPT_ALGORITHM ||
        typeof publicRecord.keyId !== 'string' ||
        typeof publicRecord.publicKeyPem !== 'string' ||
        !Number.isSafeInteger(publicRecord.validFromMs) ||
        !Number.isSafeInteger(publicRecord.validUntilMs) ||
        !(publicRecord.revokedAtMs === null || Number.isSafeInteger(publicRecord.revokedAtMs))) {
      throw new Error('KEY_STORE_CORRUPT');
    }
    createPrivateKey(record.privateKeyPem);
    createPublicKey(publicRecord.publicKeyPem);
    return Object.freeze({
      privateKeyPem: record.privateKeyPem,
      publicRecord: Object.freeze({ ...publicRecord }),
    });
  });
  if (!records.some((record) => record.publicRecord.keyId === raw.activeKeyId)) {
    throw new Error('KEY_STORE_CORRUPT');
  }
  return Object.freeze({
    schema: 'zungun.receipt-key-store.v1',
    revision: Number(raw.revision),
    activeKeyId: raw.activeKeyId,
    records: Object.freeze(records),
  });
}

function serializeState(state: FileKeyState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function atomicWrite(path: string, state: FileKeyState): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    writeFileSync(temp, serializeState(state), { mode: 0o600, flag: 'wx' });
    chmodSync(temp, 0o600);
    const descriptor = openSync(temp, 'r');
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temp, path);
    chmodSync(path, 0o600);
    const directory = openSync(dirname(path), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    try { if (existsSync(temp)) unlinkSync(temp); } catch { /* best effort cleanup */ }
    throw error;
  }
}

function withExclusiveStoreLock<T>(path: string, operation: () => T): T {
  const lockPath = `${path}.lock`;
  try {
    if (existsSync(lockPath) && Date.now() - Number(statSync(lockPath).mtimeMs) > 30_000) unlinkSync(lockPath);
  } catch {
    throw new Error('KEY_STORE_LOCK_CHECK_FAILED');
  }
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, 'wx', 0o600);
  } catch {
    throw new Error('KEY_STORE_BUSY');
  }
  try {
    writeFileSync(descriptor, `${process.pid}\n`);
    fsyncSync(descriptor);
    return operation();
  } finally {
    try { closeSync(descriptor); } finally {
      try { unlinkSync(lockPath); } catch { /* lock cleanup is best effort after close */ }
    }
  }
}

export class LocalFileReceiptKeyProvider implements RotatingReceiptKeyProvider {
  private state: FileKeyState;

  constructor(
    private readonly path: string,
    nowMs = Date.now(),
    validityMs = 365 * 24 * 60 * 60 * 1000,
  ) {
    withExclusiveStoreLock(path, () => {
      if (!existsSync(path)) {
        const record = generateRecord(nowMs, validityMs);
        atomicWrite(path, Object.freeze({
          schema: 'zungun.receipt-key-store.v1',
          revision: 1,
          activeKeyId: record.publicRecord.keyId,
          records: Object.freeze([record]),
        }));
      }
    });
    this.state = parseFileState(readFileSync(path, 'utf8'));
    chmodSync(path, 0o600);
  }

  private reload(): FileKeyState {
    this.state = parseFileState(readFileSync(this.path, 'utf8'));
    return this.state;
  }

  private mutate(transform: (current: FileKeyState) => FileKeyState): void {
    withExclusiveStoreLock(this.path, () => {
      const current = parseFileState(readFileSync(this.path, 'utf8'));
      atomicWrite(this.path, transform(current));
    });
    this.reload();
  }

  current(nowMs: number) {
    const state = this.reload();
    const record = state.records.find((candidate) => candidate.publicRecord.keyId === state.activeKeyId);
    if (!record) throw new Error('no active signing key');
    if (record.publicRecord.revokedAtMs !== null && record.publicRecord.revokedAtMs <= nowMs) {
      throw new Error('active signing key revoked');
    }
    if (nowMs < record.publicRecord.validFromMs || nowMs > record.publicRecord.validUntilMs) {
      throw new Error('no active signing key');
    }
    return Object.freeze({
      keyId: record.publicRecord.keyId,
      privateKeyPem: record.privateKeyPem,
      publicRecord: record.publicRecord,
    });
  }

  resolve(keyId: string): PublicKeyRecord | null {
    return this.reload().records.find((record) => record.publicRecord.keyId === keyId)?.publicRecord ?? null;
  }

  rotate(nowMs: number, validityMs: number): string {
    const record = generateRecord(nowMs, validityMs);
    this.mutate((current) => Object.freeze({
      schema: 'zungun.receipt-key-store.v1',
      revision: current.revision + 1,
      activeKeyId: record.publicRecord.keyId,
      records: Object.freeze([...current.records, record]),
    }));
    return record.publicRecord.keyId;
  }

  revoke(keyId: string, atMs: number): void {
    this.mutate((current) => {
      if (!current.records.some((record) => record.publicRecord.keyId === keyId)) {
        throw new Error('unknown key');
      }
      const records = current.records.map((record) => record.publicRecord.keyId === keyId
        ? Object.freeze({
          privateKeyPem: record.privateKeyPem,
          publicRecord: Object.freeze({ ...record.publicRecord, revokedAtMs: atMs }),
        })
        : record);
      return Object.freeze({
        schema: 'zungun.receipt-key-store.v1',
        revision: current.revision + 1,
        activeKeyId: current.activeKeyId,
        records: Object.freeze(records),
      });
    });
  }

  list(): readonly PublicKeyRecord[] {
    return Object.freeze(this.reload().records.map((record) => record.publicRecord)
      .sort((a, b) => a.validFromMs - b.validFromMs || a.keyId.localeCompare(b.keyId)));
  }
}
