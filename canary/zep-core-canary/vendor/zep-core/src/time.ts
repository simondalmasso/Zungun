import { fail } from './errors.js';

const MAX_I64 = 9_223_372_036_854_775_807n;

export function validateEpochMs(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_TIMESTAMP', `${field} must be a non-negative safe integer`);
  if (BigInt(value) > MAX_I64) fail('INTEGER_OVERFLOW', `${field} exceeds signed 64-bit range`);
  return value;
}

export function effectiveNow(previousEffectiveNowMs: number, observedWallClockMs: number): number {
  validateEpochMs(previousEffectiveNowMs, 'previousEffectiveNowMs');
  validateEpochMs(observedWallClockMs, 'observedWallClockMs');
  return Math.max(previousEffectiveNowMs, observedWallClockMs);
}

export function isExpired(expiresAtMs: number, nowMs: number): boolean {
  validateEpochMs(expiresAtMs, 'expiresAtMs');
  validateEpochMs(nowMs, 'nowMs');
  return nowMs >= expiresAtMs;
}
