export type ZepErrorCode =
  | 'INVALID_VERSION'
  | 'INVALID_IDENTIFIER'
  | 'INVALID_TIMESTAMP'
  | 'EXPIRED'
  | 'INVALID_PRIORITY'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'UNSUPPORTED_RECEIPT_POLICY'
  | 'PAYLOAD_TOO_LARGE'
  | 'FRAGMENT_OUT_OF_RANGE'
  | 'FRAGMENT_SET_MISMATCH'
  | 'DUPLICATE_CONFLICT'
  | 'AUTHENTICATION_FAILED'
  | 'RECEIPT_INVALID'
  | 'REPLAY_DETECTED'
  | 'INVALID_STATE_TRANSITION'
  | 'PERSISTENCE_FAILED'
  | 'CORRUPT_RECORD'
  | 'CLOCK_INVALID'
  | 'INTEGER_OVERFLOW'
  | 'CANCELLED_BY_USER'
  | 'NO_ELIGIBLE_TRANSPORT'
  | 'DEADLINE_NOT_FEASIBLE'
  | 'CAPABILITY_MISMATCH'
  | 'POLICY_BLOCKED'
  | 'COST_BUDGET_EXCEEDED'
  | 'ENERGY_BUDGET_EXCEEDED'
  | 'SERVICE_NOT_ENTITLED'
  | 'APP_NOT_ALLOWED'
  | 'MARKET_NOT_ENABLED'
  | 'REGULATORY_STATUS_UNKNOWN'
  | 'TEMPORARY_UNAVAILABLE'
  | 'PERMANENTLY_REJECTED'
  | 'OUTCOME_UNKNOWN'
  | 'CANCEL_UNSUPPORTED'
  | 'RECEIPT_UNSUPPORTED'
  | 'EXTERNAL_REFERENCE_INVALID'
  | 'METADATA_POLICY_VIOLATION'
  | 'SECRET_EXPOSURE_ATTEMPT'
  | 'UNTRUSTED_EXTENSION'
  | 'UNSAFE_LOGGING_ATTEMPT';

const ZEP_ERROR_CODES: ReadonlySet<ZepErrorCode> = new Set<ZepErrorCode>([
  'INVALID_VERSION', 'INVALID_IDENTIFIER', 'INVALID_TIMESTAMP', 'EXPIRED', 'INVALID_PRIORITY',
  'UNSUPPORTED_CONTENT_TYPE', 'UNSUPPORTED_RECEIPT_POLICY', 'PAYLOAD_TOO_LARGE', 'FRAGMENT_OUT_OF_RANGE',
  'FRAGMENT_SET_MISMATCH', 'DUPLICATE_CONFLICT', 'AUTHENTICATION_FAILED', 'RECEIPT_INVALID',
  'REPLAY_DETECTED', 'INVALID_STATE_TRANSITION', 'PERSISTENCE_FAILED', 'CORRUPT_RECORD', 'CLOCK_INVALID',
  'INTEGER_OVERFLOW', 'CANCELLED_BY_USER', 'NO_ELIGIBLE_TRANSPORT', 'DEADLINE_NOT_FEASIBLE',
  'CAPABILITY_MISMATCH', 'POLICY_BLOCKED', 'COST_BUDGET_EXCEEDED', 'ENERGY_BUDGET_EXCEEDED',
  'SERVICE_NOT_ENTITLED', 'APP_NOT_ALLOWED', 'MARKET_NOT_ENABLED', 'REGULATORY_STATUS_UNKNOWN',
  'TEMPORARY_UNAVAILABLE', 'PERMANENTLY_REJECTED', 'OUTCOME_UNKNOWN', 'CANCEL_UNSUPPORTED',
  'RECEIPT_UNSUPPORTED', 'EXTERNAL_REFERENCE_INVALID', 'METADATA_POLICY_VIOLATION',
  'SECRET_EXPOSURE_ATTEMPT', 'UNTRUSTED_EXTENSION', 'UNSAFE_LOGGING_ATTEMPT',
]);

export class ZepError extends Error {
  readonly name = 'ZepError';
  constructor(
    readonly code: ZepErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export function fail(code: ZepErrorCode, message: string, retryable = false): never {
  throw new ZepError(code, message, retryable);
}

export interface ErrorRecord {
  readonly errorCode: ZepErrorCode;
  readonly messageId: string | null;
  readonly attemptId: string | null;
  readonly adapterId: string | null;
  readonly atMs: number;
  readonly retryable: boolean;
  readonly publicDetail: string;
  readonly privateDiagnosticReference: string | null;
}

const SENSITIVE_PATTERNS = [
  /authorization\s*:/i,
  /bearer\s+[a-z0-9._-]+/i,
  /private[_ -]?key/i,
  /password/i,
  /cookie/i,
  /jwt/i,
  /plaintext[_ -]?payload/i,
];

export function createSafeErrorRecord(input: ErrorRecord): ErrorRecord {
  let isArray = false;
  try { isArray = Array.isArray(input); }
  catch { fail('CORRUPT_RECORD', 'ErrorRecord cannot be inspected safely'); }
  if (typeof input !== 'object' || input === null || isArray) {
    fail('CORRUPT_RECORD', 'ErrorRecord must be a plain object');
  }
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(input);
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch {
    fail('CORRUPT_RECORD', 'ErrorRecord cannot be inspected safely');
  }
  if (prototype !== Object.prototype && prototype !== null) fail('CORRUPT_RECORD', 'ErrorRecord must be a plain object');
  const allowed = new Set(['errorCode', 'messageId', 'attemptId', 'adapterId', 'atMs', 'retryable', 'publicDetail', 'privateDiagnosticReference']);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.has(key)) fail('CORRUPT_RECORD', 'ErrorRecord contains unsupported field');
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !('value' in descriptor) || 'get' in descriptor || 'set' in descriptor) {
      fail('CORRUPT_RECORD', `ErrorRecord.${key} must be an enumerable data property`);
    }
  }
  const read = (key: string): unknown => descriptors[key] && 'value' in descriptors[key]! ? descriptors[key]!.value : undefined;
  const errorCode = read('errorCode');
  if (typeof errorCode !== 'string' || !ZEP_ERROR_CODES.has(errorCode as ZepErrorCode)) {
    fail('CORRUPT_RECORD', 'errorCode must be a supported ZEP error code');
  }
  const nullableId = (value: unknown, field: string): string | null => {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /\s/.test(value)) fail('INVALID_IDENTIFIER', `${field} is invalid`);
    return value;
  };
  const messageId = nullableId(read('messageId'), 'messageId');
  const attemptId = nullableId(read('attemptId'), 'attemptId');
  const adapterId = nullableId(read('adapterId'), 'adapterId');
  const atMs = read('atMs');
  if (!Number.isSafeInteger(atMs) || (atMs as number) < 0) fail('INVALID_TIMESTAMP', 'Invalid error timestamp');
  const retryable = read('retryable');
  if (typeof retryable !== 'boolean') fail('CORRUPT_RECORD', 'retryable must be boolean');
  const publicDetail = read('publicDetail');
  if (typeof publicDetail !== 'string') fail('CORRUPT_RECORD', 'publicDetail must be string');
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(publicDetail))) {
    fail('UNSAFE_LOGGING_ATTEMPT', 'Public detail contains sensitive material');
  }
  const privateDiagnosticReference = nullableId(read('privateDiagnosticReference'), 'privateDiagnosticReference');
  return Object.freeze({
    errorCode: errorCode as ZepErrorCode,
    messageId,
    attemptId,
    adapterId,
    atMs: atMs as number,
    retryable,
    publicDetail,
    privateDiagnosticReference,
  });
}
