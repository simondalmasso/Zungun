import type { DeliveryProfileV2, LinkSnapshot } from './types.js';

export interface PrefetchHint {
  readonly resourceKey: string;
  readonly revisionOrHash: string;
  readonly sizeEstimate: number;
  readonly expiresAtMs: number;
  readonly priority: 'HIGH' | 'NORMAL' | 'BULK';
  readonly sensitivityClass: 'PUBLIC' | 'INTERNAL' | 'SENSITIVE';
  readonly allowedOrigin: string;
}

export interface PrefetchBudget {
  readonly remainingBytes: number;
  readonly remainingObjects: number;
  readonly allowedOrigins: readonly string[];
  readonly currentRevisionByResource: Readonly<Record<string, string>>;
}

export interface PrefetchSelection {
  readonly selected: readonly PrefetchHint[];
  readonly rejected: readonly { readonly resourceKey: string; readonly reason: string }[];
  readonly bytesSelected: number;
}

const PRIORITY: Readonly<Record<PrefetchHint['priority'], number>> = Object.freeze({ HIGH: 0, NORMAL: 1, BULK: 2 });

function validHint(hint: PrefetchHint): boolean {
  return /^[A-Za-z0-9._:@/+\-]{1,256}$/.test(hint.resourceKey) &&
    /^[A-Za-z0-9._:@/+\-]{1,256}$/.test(hint.revisionOrHash) &&
    Number.isSafeInteger(hint.sizeEstimate) && hint.sizeEstimate >= 0 && hint.sizeEstimate <= 100_000_000 &&
    Number.isSafeInteger(hint.expiresAtMs) &&
    /^https:\/\/[^/?#]+$/.test(hint.allowedOrigin);
}

function goodForPrefetch(profile: DeliveryProfileV2, snapshot: LinkSnapshot): boolean {
  if (!snapshot.hasNetwork || !snapshot.internetCapable || !snapshot.validated || snapshot.captivePortal || snapshot.suspended || snapshot.congested) return false;
  if (snapshot.metered && !snapshot.temporarilyUnmetered && !profile.allowMetered) return false;
  if (snapshot.roaming && !profile.allowRoaming) return false;
  return true;
}

export function selectPrefetchHints(
  hints: readonly PrefetchHint[],
  profile: DeliveryProfileV2,
  snapshot: LinkSnapshot,
  budget: PrefetchBudget,
  nowMs: number,
): PrefetchSelection {
  if (hints.length > 256) throw new Error('LINK_PREFETCH_HINT_LIMIT_EXCEEDED');
  if (!Number.isSafeInteger(budget.remainingBytes) || budget.remainingBytes < 0 || !Number.isSafeInteger(budget.remainingObjects) || budget.remainingObjects < 0) throw new Error('LINK_PREFETCH_BUDGET_INVALID');
  const allow = new Set(budget.allowedOrigins);
  const rejected: Array<{resourceKey:string;reason:string}> = [];
  if (!goodForPrefetch(profile, snapshot)) return Object.freeze({ selected:Object.freeze([]), rejected:Object.freeze(hints.map((hint)=>Object.freeze({resourceKey:hint.resourceKey,reason:'LINK_NOT_ELIGIBLE'}))), bytesSelected:0 });
  let bytes = 0;
  const selected: PrefetchHint[] = [];
  for (const hint of [...hints].sort((a,b)=>PRIORITY[a.priority]-PRIORITY[b.priority] || a.expiresAtMs-b.expiresAtMs || a.resourceKey.localeCompare(b.resourceKey))) {
    if (!validHint(hint)) { rejected.push({resourceKey:hint.resourceKey,reason:'INVALID_HINT'}); continue; }
    if (hint.expiresAtMs <= nowMs) { rejected.push({resourceKey:hint.resourceKey,reason:'RESOURCE_EXPIRED'}); continue; }
    if (!allow.has(hint.allowedOrigin)) { rejected.push({resourceKey:hint.resourceKey,reason:'ORIGIN_NOT_ALLOWED'}); continue; }
    if (budget.currentRevisionByResource[hint.resourceKey] === hint.revisionOrHash) { rejected.push({resourceKey:hint.resourceKey,reason:'REVISION_ALREADY_PRESENT'}); continue; }
    if (selected.length >= budget.remainingObjects || bytes + hint.sizeEstimate > budget.remainingBytes) { rejected.push({resourceKey:hint.resourceKey,reason:'BUDGET_EXHAUSTED'}); continue; }
    selected.push(hint); bytes += hint.sizeEstimate;
  }
  return Object.freeze({ selected:Object.freeze(selected), rejected:Object.freeze(rejected.map((item)=>Object.freeze({...item}))), bytesSelected:bytes });
}

export type OpportunityKind = 'CRITICAL_OPERATION' | 'RECONCILIATION' | 'REQUIRED_DEFERRED' | 'DEFERRED' | 'PREFETCH';
export interface OpportunityTask { readonly id: string; readonly kind: OpportunityKind; readonly deadlineAtMs: number | null; readonly enqueuedAtMs: number; }
const OPPORTUNITY_ORDER: Readonly<Record<OpportunityKind, number>> = Object.freeze({ CRITICAL_OPERATION:0, RECONCILIATION:1, REQUIRED_DEFERRED:2, DEFERRED:3, PREFETCH:4 });
export function orderGoodLinkOpportunity(tasks: readonly OpportunityTask[], limit = 64): readonly OpportunityTask[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1024) throw new Error('LINK_OPPORTUNITY_LIMIT_INVALID');
  return Object.freeze([...tasks].sort((a,b)=>OPPORTUNITY_ORDER[a.kind]-OPPORTUNITY_ORDER[b.kind] || (a.deadlineAtMs??Number.MAX_SAFE_INTEGER)-(b.deadlineAtMs??Number.MAX_SAFE_INTEGER) || a.enqueuedAtMs-b.enqueuedAtMs || a.id.localeCompare(b.id)).slice(0,limit));
}
