import { sha256Canonical } from './canonical.js';

export type LinkTraceKind = 'QUEUED' | 'PLAN' | 'TRANSPORT' | 'RECONCILIATION_STARTED' | 'RECONCILIATION_RESULT' | 'DEFERRED' | 'GOOD_LINK_FLUSH' | 'HEAVY_OBJECT_COMPLETE';
export interface LinkTraceEvent {
  readonly atMs: number;
  readonly kind: LinkTraceKind;
  readonly state: string;
  readonly reasonCodes: readonly string[];
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
  readonly eventSha256: string;
}

const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|credential|ssid|subscriber|imsi|imei)/i;
const SENSITIVE_VALUE = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/i;

export function createLinkTraceEvent(input: Omit<LinkTraceEvent,'eventSha256'>): LinkTraceEvent {
  if (!Number.isSafeInteger(input.atMs) || input.atMs < 0) throw new Error('LINK_TRACE_TIME_INVALID');
  for (const [key,value] of Object.entries(input.details)) {
    if (SENSITIVE_KEY.test(key) || typeof value === 'string' && SENSITIVE_VALUE.test(value)) throw new Error('LINK_TRACE_SENSITIVE_DETAIL');
  }
  return Object.freeze({ ...input, reasonCodes:Object.freeze([...input.reasonCodes]), details:Object.freeze({...input.details}), eventSha256:sha256Canonical(input) });
}

export function formatLinkTrace(events: readonly LinkTraceEvent[]): string {
  let last = -1;
  return events.map((event)=>{
    if (event.atMs < last) throw new Error('LINK_TRACE_TIME_REGRESSION');
    last = event.atMs;
    const reasons = event.reasonCodes.length ? ` [${event.reasonCodes.join(',')}]` : '';
    return `${new Date(event.atMs).toISOString()} ${event.kind} ${event.state}${reasons}`;
  }).join('\n');
}
