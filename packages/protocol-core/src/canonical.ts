import { createHash } from 'node:crypto';

export type CanonicalPrimitive = null | boolean | number | string;
export type CanonicalValue = CanonicalPrimitive | readonly CanonicalValue[] | { readonly [key: string]: CanonicalValue };

function assertFiniteNumber(value: number): number {
  if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError('canonical numbers must be finite and not negative zero');
  return value;
}

export function canonicalize(value: CanonicalValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(assertFiniteNumber(value));
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, CanonicalValue>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key]!)}`).join(',')}}`;
  }
  throw new TypeError('unsupported canonical value');
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function commitmentFor(value: CanonicalValue): string {
  return `sha256:${sha256Hex(canonicalize(value))}`;
}
