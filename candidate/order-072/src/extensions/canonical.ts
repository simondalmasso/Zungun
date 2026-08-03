// PROVENANCE: RECONSTRUCTED_FROM_ORDER; extension utility, not part of the historical oracle root.
import { createHash } from 'node:crypto';

function normalize(input: unknown): unknown {
  if (input instanceof Uint8Array) return { $bytesBase64: Buffer.from(input).toString('base64') };
  if (Array.isArray(input)) return input.map(normalize);
  if (input !== null && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalize(record[key])]));
  }
  return input;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function prettyCanonicalJson(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`;
}

export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}
