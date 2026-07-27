import { fail } from './errors.js';
import { validateEpochMs } from './time.js';
import type { ExtensionObject, ExtensionValue } from './types.js';

function ownDescriptors(value: object, field: string): PropertyDescriptorMap {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    fail('CORRUPT_RECORD', `${field} cannot be inspected safely`);
  }
}

export function requirePlainRecord(value: unknown, field: string): Record<string, unknown> {
  let isArray = false;
  try { isArray = Array.isArray(value); }
  catch { fail('CORRUPT_RECORD', `${field} cannot be inspected safely`); }
  if (typeof value !== 'object' || value === null || isArray) {
    fail('CORRUPT_RECORD', `${field} must be a plain object`);
  }
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    fail('CORRUPT_RECORD', `${field} prototype cannot be inspected safely`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail('CORRUPT_RECORD', `${field} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

export function assertExactKeys(value: unknown, allowedKeys: readonly string[], field: string): void {
  const record = requirePlainRecord(value, field);
  const allowed = new Set(allowedKeys);
  const descriptors = ownDescriptors(record, field);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') fail('CORRUPT_RECORD', `${field} contains unsupported symbol field`);
    const descriptor = descriptors[key]!;
    if (!allowed.has(key)) fail('CORRUPT_RECORD', `${field} contains unsupported field ${key}`);
    if (!descriptor.enumerable) fail('CORRUPT_RECORD', `${field}.${key} must be enumerable`);
    if (!('value' in descriptor) || 'get' in descriptor || 'set' in descriptor) {
      fail('CORRUPT_RECORD', `${field}.${key} must be a data property`);
    }
  }
}

export function snapshotExactRecord(value: unknown, allowedKeys: readonly string[], field: string): Record<string, unknown> {
  const record = requirePlainRecord(value, field);
  assertExactKeys(record, allowedKeys, field);
  const descriptors = ownDescriptors(record, field);
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of allowedKeys) {
    const descriptor = descriptors[key];
    if (descriptor && 'value' in descriptor) snapshot[key] = descriptor.value;
  }
  return snapshot;
}

export function requireOpaqueId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /\s/.test(value)) {
    fail('INVALID_IDENTIFIER', `${field} is invalid`);
  }
  return value;
}

export function requireOptionalOpaqueId(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireOpaqueId(value, field);
}

export function requireNullableOpaqueId(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requireOpaqueId(value, field);
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail('CORRUPT_RECORD', `${field} must be boolean`);
  return value;
}

export function requireNonNegativeSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail('CORRUPT_RECORD', `${field} must be a non-negative safe integer`);
  }
  return value as number;
}

export function requirePositiveSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail('CORRUPT_RECORD', `${field} must be a positive safe integer`);
  }
  return value as number;
}

export function requireEpochMs(value: unknown, field: string): number {
  if (typeof value !== 'number') fail('INVALID_TIMESTAMP', `${field} must be numeric`);
  return validateEpochMs(value, field);
}

export function requireReasonCode(value: unknown, field = 'reasonCode'): string {
  return requireOpaqueId(value, field);
}

export function requireEnum<T extends string>(value: unknown, field: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    fail('CORRUPT_RECORD', `${field} is invalid`);
  }
  return value as T;
}

export function requireUint8Array(value: unknown, field: string): Uint8Array {
  let valid = false;
  try { valid = value instanceof Uint8Array; }
  catch { fail('CORRUPT_RECORD', `${field} cannot be inspected safely`); }
  if (!valid) fail('CORRUPT_RECORD', `${field} must be Uint8Array`);
  return value as Uint8Array;
}

const MAX_EXTENSION_DEPTH = 16;
const MAX_EXTENSION_NODES = 4096;

export function normalizeExtensions(value: unknown): ExtensionObject | undefined {
  if (value === undefined) return undefined;
  let nodes = 0;

  const visit = (input: unknown, depth: number): ExtensionValue => {
    nodes += 1;
    if (nodes > MAX_EXTENSION_NODES) fail('UNTRUSTED_EXTENSION', 'extensions exceed node limit');
    if (depth > MAX_EXTENSION_DEPTH) fail('UNTRUSTED_EXTENSION', 'extensions exceed depth limit');

    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) fail('UNTRUSTED_EXTENSION', 'extensions contain non-finite number');
      return input;
    }
    let isArray = false;
    try { isArray = Array.isArray(input); }
    catch { fail('UNTRUSTED_EXTENSION', 'extensions array cannot be inspected safely'); }
    if (isArray) {
      let values: readonly unknown[];
      try {
        values = Array.from(input as readonly unknown[]);
      } catch {
        fail('UNTRUSTED_EXTENSION', 'extensions array cannot be inspected safely');
      }
      return Object.freeze(values.map((item) => visit(item, depth + 1)));
    }
    if (typeof input !== 'object') fail('UNTRUSTED_EXTENSION', 'extensions contain unsupported value');

    let prototype: object | null;
    try {
      prototype = Object.getPrototypeOf(input);
    } catch {
      fail('UNTRUSTED_EXTENSION', 'extensions object cannot be inspected safely');
    }
    if (prototype !== Object.prototype && prototype !== null) {
      fail('UNTRUSTED_EXTENSION', 'extensions must contain only plain objects');
    }
    let descriptors: PropertyDescriptorMap;
    try {
      descriptors = Object.getOwnPropertyDescriptors(input);
    } catch {
      fail('UNTRUSTED_EXTENSION', 'extensions descriptors cannot be inspected safely');
    }
    const output: Record<string, ExtensionValue> = Object.create(null) as Record<string, ExtensionValue>;
    for (const key of Reflect.ownKeys(descriptors).sort((a, b) => { const left = String(a); const right = String(b); return left === right ? 0 : left < right ? -1 : 1; })) {
      if (typeof key !== 'string') fail('UNTRUSTED_EXTENSION', 'extensions cannot contain symbol keys');
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable) fail('UNTRUSTED_EXTENSION', 'extensions cannot contain hidden fields');
      if (!('value' in descriptor) || 'get' in descriptor || 'set' in descriptor) {
        fail('UNTRUSTED_EXTENSION', 'extensions cannot contain accessors');
      }
      if (key.length < 1 || key.length > 128) fail('UNTRUSTED_EXTENSION', 'extensions key is invalid');
      output[key] = visit(descriptor.value, depth + 1);
    }
    return Object.freeze(output);
  };

  const normalized = visit(value, 0);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== 'object') {
    fail('UNTRUSTED_EXTENSION', 'extensions root must be an object');
  }
  return normalized as ExtensionObject;
}

export function checkedAddMs(baseMs: number, durationMs: number, field: string): number {
  validateEpochMs(baseMs, `${field}.baseMs`);
  requireNonNegativeSafeInteger(durationMs, `${field}.durationMs`);
  const result = baseMs + durationMs;
  if (!Number.isSafeInteger(result)) fail('INTEGER_OVERFLOW', `${field} overflows safe integer range`);
  return result;
}
