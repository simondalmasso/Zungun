export type ScenarioName =
  | 'offline_transport'
  | 'intermittent_transport'
  | 'delay'
  | 'timeout'
  | 'duplication'
  | 'reordering'
  | 'truncation'
  | 'process_death'
  | 'reboot'
  | 'upgrade'
  | 'clock_skew'
  | 'ttl_expiry'
  | 'storage_failure'
  | 'receiver_crash'
  | 'lease_loss'
  | 'ack_loss'
  | 'delayed_effect'
  | 'database_erp_mismatch'
  | 'receipt_tampering'
  | 'stale_key'
  | 'revoked_key'
  | 'reconciliation_contradiction'
  | 'silent_device'
  | 'unauthorized_role'
  | 'key_store_corruption'
  | 'static_path_traversal';

export interface ResilienceScenario {
  readonly name: ScenarioName;
  readonly seed: number;
  readonly expectedOutcome: string;
  readonly injectedFault: string;
}

export function deterministicScenarios(): readonly ResilienceScenario[] {
  const rows: readonly [ScenarioName, string, string][] = [
    ['offline_transport', 'UNKNOWN', 'no receiver invocation while operation remains durable'],
    ['intermittent_transport', 'EFFECT_CONFIRMED', 'first transport omitted then successful retry'],
    ['delay', 'EFFECT_CONFIRMED', 'application effect arrives after transport delay'],
    ['timeout', 'UNKNOWN', 'application response is ambiguous after claim'],
    ['duplication', 'DUPLICATE_WITH_RECEIPT', 'same envelope delivered repeatedly'],
    ['reordering', 'UNKNOWN', 'application acknowledgement observed before effect evidence'],
    ['truncation', 'INVALID_PAYLOAD_BASE64', 'wire payload is truncated'],
    ['process_death', 'RECOVERED_PENDING', 'database is closed and reopened before delivery'],
    ['reboot', 'RECOVERED_PENDING', 'pending durable queue is reconstructed after restart'],
    ['upgrade', 'RECEIVER_ACCEPTED', 'client version changes without changing operation identity'],
    ['clock_skew', 'CREATED_IN_FUTURE', 'device creation time exceeds accepted skew'],
    ['ttl_expiry', 'TTL_EXPIRED', 'envelope deadline passes before acceptance'],
    ['storage_failure', 'STORAGE_FAILURE', 'SQLite path is intentionally invalid'],
    ['receiver_crash', 'EFFECT_CONFIRMED', 'receiver closes after accept and restarts before effect'],
    ['lease_loss', 'LEASE_LOST', 'stale fencing token records effect'],
    ['ack_loss', 'UNKNOWN', 'business effect lacks application acknowledgement'],
    ['delayed_effect', 'EFFECT_CONFIRMED', 'unknown result is followed by qualifying application evidence'],
    ['database_erp_mismatch', 'COMPENSATION_REQUIRED', 'application and ERP effects contradict'],
    ['receipt_tampering', 'RECEIPT_INVALID', 'signed receipt payload is modified'],
    ['stale_key', 'KEY_NOT_YET_VALID', 'receipt is checked before key validity'],
    ['revoked_key', 'KEY_REVOKED', 'key is revoked after signing'],
    ['reconciliation_contradiction', 'COMPENSATION_REQUIRED', 'effect and no-effect facts coexist'],
    ['silent_device', 'INCOMPLETE_DECLARED_SCOPE', 'declared device never reports'],
    ['unauthorized_role', 'FORBIDDEN', 'ingest principal attempts key management'],
    ['key_store_corruption', 'KEY_STORE_CORRUPT', 'durable key store is overwritten with invalid JSON'],
    ['static_path_traversal', 'PATH_CONTAINED', 'resolved static path escapes configured root'],
  ];
  return Object.freeze(rows.map(([name, expectedOutcome, injectedFault], index) => Object.freeze({
    name,
    seed: 76001 + index,
    expectedOutcome,
    injectedFault,
  })));
}
