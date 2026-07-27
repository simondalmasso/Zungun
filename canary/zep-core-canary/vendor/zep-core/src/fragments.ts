import { fail } from './errors.js';
import { isExpired } from './time.js';
import {
  requireBoolean,
  requireEpochMs,
  requireNonNegativeSafeInteger,
  requireOpaqueId,
  requirePositiveSafeInteger,
  requireUint8Array,
  snapshotExactRecord,
} from './validation.js';
import type { Fragment } from './types.js';


function snapshotFragmentArray(value: unknown): readonly unknown[] {
  let isArray = false;
  try { isArray = Array.isArray(value); } catch { fail('FRAGMENT_SET_MISMATCH', 'Fragment set cannot be inspected safely'); }
  if (!isArray) fail('FRAGMENT_SET_MISMATCH', 'Fragment set must be an array');
  try { return Object.freeze(Array.from(value as readonly unknown[])); }
  catch { fail('FRAGMENT_SET_MISMATCH', 'Fragment set cannot be inspected safely'); }
}

export function validateFragment(fragment: Fragment): Fragment {
  const record = snapshotExactRecord(fragment, ['messageId', 'messageCommitment', 'fragmentIndex', 'fragmentCount', 'byteOffset', 'fragmentPayload', 'authenticated', 'expiresAtMs'], 'Fragment');
  const messageId = requireOpaqueId(record.messageId, 'messageId');
  const messageCommitment = requireOpaqueId(record.messageCommitment, 'messageCommitment');
  const fragmentIndex = requireNonNegativeSafeInteger(record.fragmentIndex, 'fragmentIndex');
  const fragmentCount = requirePositiveSafeInteger(record.fragmentCount, 'fragmentCount');
  if (fragmentIndex >= fragmentCount) fail('FRAGMENT_OUT_OF_RANGE', 'fragmentIndex is outside fragmentCount');
  const byteOffset = requireNonNegativeSafeInteger(record.byteOffset, 'byteOffset');
  const fragmentPayload = requireUint8Array(record.fragmentPayload, 'fragmentPayload').slice();
  const authenticated = requireBoolean(record.authenticated, 'authenticated');
  const expiresAtMs = requireEpochMs(record.expiresAtMs, 'expiresAtMs');
  return Object.freeze({ messageId, messageCommitment, fragmentIndex, fragmentCount, byteOffset, fragmentPayload, authenticated, expiresAtMs });
}

export function reassembleFragments(fragments: readonly Fragment[], nowMs: number): Uint8Array {
  requireEpochMs(nowMs, 'nowMs');
  let values: readonly unknown[];
  try {
    values = snapshotFragmentArray(fragments);
  } catch {
    fail('FRAGMENT_SET_MISMATCH', 'Fragment set cannot be inspected safely');
  }
  if (values.length === 0) fail('FRAGMENT_SET_MISMATCH', 'Fragment set is empty');
  const validated = values.map((fragment) => validateFragment(fragment as never));
  const first = validated[0]!;
  if (validated.length !== first.fragmentCount) fail('FRAGMENT_SET_MISMATCH', 'Fragment set is incomplete');
  if (isExpired(first.expiresAtMs, nowMs)) fail('EXPIRED', 'Fragment set is expired');

  const byIndex = new Map<number, Fragment>();
  for (const fragment of validated) {
    if (!fragment.authenticated) fail('AUTHENTICATION_FAILED', 'Fragment authentication failed');
    if (
      fragment.messageId !== first.messageId ||
      fragment.messageCommitment !== first.messageCommitment ||
      fragment.fragmentCount !== first.fragmentCount ||
      fragment.expiresAtMs !== first.expiresAtMs
    ) fail('FRAGMENT_SET_MISMATCH', 'Fragment identity fields differ');

    const existing = byIndex.get(fragment.fragmentIndex);
    if (existing) {
      const exact = existing.byteOffset === fragment.byteOffset &&
        existing.fragmentPayload.byteLength === fragment.fragmentPayload.byteLength &&
        existing.fragmentPayload.every((value, index) => value === fragment.fragmentPayload[index]);
      if (!exact) fail('FRAGMENT_SET_MISMATCH', 'Conflicting duplicate fragment');
      continue;
    }
    byIndex.set(fragment.fragmentIndex, fragment);
  }
  if (byIndex.size !== first.fragmentCount) fail('FRAGMENT_SET_MISMATCH', 'Missing fragment index');
  const ordered = [...byIndex.values()].sort((a, b) => a.byteOffset - b.byteOffset);
  let expectedOffset = 0;
  for (const fragment of ordered) {
    if (fragment.byteOffset !== expectedOffset) fail('FRAGMENT_SET_MISMATCH', 'Fragment ranges overlap or contain gaps');
    const nextOffset = expectedOffset + fragment.fragmentPayload.byteLength;
    if (!Number.isSafeInteger(nextOffset)) fail('INTEGER_OVERFLOW', 'Reassembled payload size overflow');
    expectedOffset = nextOffset;
  }
  const output = new Uint8Array(expectedOffset);
  for (const fragment of ordered) output.set(fragment.fragmentPayload, fragment.byteOffset);
  return output;
}
