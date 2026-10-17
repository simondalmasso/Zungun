import { canonicalize, sha256Hex, type CanonicalValue } from './canonical.js';

export const WITNESS_SCHEMA_VERSION = 'zungun-witness/1' as const;
export const WITNESS_STATES = Object.freeze([
  'DETECTED','COMMITTED_LOCAL','CUSTODY_ACCEPTED','DELIVERED_DURABLY','OWNED_BY_RESPONDER',
  'ACTION_STARTED','CONDITION_RECHECKED','RESOLVED','RECONCILED','UNKNOWN','CONFLICT','EXPIRED_WITHOUT_RESOLUTION',
] as const);
export type WitnessState = typeof WITNESS_STATES[number];
export type EvidenceClass = 'OBSERVED_FACT' | 'MACHINE_ASSERTION' | 'HUMAN_ATTESTATION' | 'DERIVED_CONCLUSION';
export const WITNESS_BOUNDARIES = Object.freeze([
  'SENSOR_OR_SOURCE','TRANSPORT','RECEIVER','INCIDENT_PLATFORM','RESPONDER','ZUNGUN_WITNESS',
] as const);
export type WitnessBoundary = typeof WITNESS_BOUNDARIES[number];
export const WITNESS_TRANSPORTS = Object.freeze([
  'CELLULAR','WIFI','LORA_RADIO','MESH','STORE_FORWARD','HTTP_WEBHOOK','SATELLITE','HUMAN',
] as const);
export type WitnessTransport = typeof WITNESS_TRANSPORTS[number];

export interface WitnessEvidenceInput {
  readonly incidentId: string;
  readonly evidenceId: string;
  readonly state: WitnessState;
  readonly evidenceClass: EvidenceClass;
  readonly emitterId: string;
  readonly authorizationScope: string;
  readonly observedAtMs: number;
  readonly monotonicMs: number;
  readonly provenance: string;
  readonly reasonCode: string;
  readonly claims: Readonly<Record<string, CanonicalValue>>;
}

export function parseWitnessEvidenceInput(raw: unknown): WitnessEvidenceInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('WITNESS_INVALID_INPUT');
  const value = raw as Record<string, unknown>;
  const state = value.state;
  const evidenceClass = value.evidenceClass;
  if (typeof state !== 'string' || !(WITNESS_STATES as readonly string[]).includes(state)) throw new Error('WITNESS_INVALID_STATE');
  if (typeof evidenceClass !== 'string' || !['OBSERVED_FACT','MACHINE_ASSERTION','HUMAN_ATTESTATION','DERIVED_CONCLUSION'].includes(evidenceClass)) throw new Error('WITNESS_INVALID_EVIDENCE_CLASS');
  if (!value.claims || typeof value.claims !== 'object' || Array.isArray(value.claims)) throw new Error('WITNESS_INVALID_CLAIMS');
  const text = (key: string) => { const item=value[key]; if(typeof item !== 'string') throw new Error(`WITNESS_INVALID_${key.toUpperCase()}`); return item; };
  const integer = (key: string) => { const item=value[key]; if(typeof item !== 'number' || !Number.isSafeInteger(item)) throw new Error(`WITNESS_INVALID_${key.toUpperCase()}`); return item; };
  return Object.freeze({ incidentId:text('incidentId'), evidenceId:text('evidenceId'), state:state as WitnessState, evidenceClass:evidenceClass as EvidenceClass, emitterId:text('emitterId'), authorizationScope:text('authorizationScope'), observedAtMs:integer('observedAtMs'), monotonicMs:integer('monotonicMs'), provenance:text('provenance'), reasonCode:text('reasonCode'), claims:value.claims as Readonly<Record<string,CanonicalValue>> });
}

export interface WitnessEvidence extends WitnessEvidenceInput {
  readonly schemaVersion: typeof WITNESS_SCHEMA_VERSION;
  readonly previousState: WitnessState | null;
  readonly previousHash: string | null;
  readonly chainPosition: number;
  readonly evidenceHash: string;
}

const ID = /^[A-Za-z0-9._:@/+\-]{1,256}$/;
const REASON = /^[A-Z0-9_]{2,96}$/;
const TRANSITIONS: Readonly<Record<string, readonly WitnessState[]>> = Object.freeze({
  START: ['DETECTED'],
  DETECTED: ['COMMITTED_LOCAL','UNKNOWN','CONFLICT','EXPIRED_WITHOUT_RESOLUTION'],
  COMMITTED_LOCAL: ['CUSTODY_ACCEPTED','UNKNOWN','CONFLICT','EXPIRED_WITHOUT_RESOLUTION'],
  CUSTODY_ACCEPTED: ['DELIVERED_DURABLY','UNKNOWN','CONFLICT','EXPIRED_WITHOUT_RESOLUTION'],
  DELIVERED_DURABLY: ['OWNED_BY_RESPONDER','UNKNOWN','CONFLICT','EXPIRED_WITHOUT_RESOLUTION'],
  OWNED_BY_RESPONDER: ['ACTION_STARTED','UNKNOWN','CONFLICT','EXPIRED_WITHOUT_RESOLUTION'],
  ACTION_STARTED: ['CONDITION_RECHECKED','UNKNOWN','CONFLICT','EXPIRED_WITHOUT_RESOLUTION'],
  CONDITION_RECHECKED: ['RESOLVED','UNKNOWN','CONFLICT','EXPIRED_WITHOUT_RESOLUTION'],
  RESOLVED: ['RECONCILED','CONFLICT'],
  UNKNOWN: ['RECONCILED','CONFLICT','EXPIRED_WITHOUT_RESOLUTION'],
  CONFLICT: ['RECONCILED'],
  EXPIRED_WITHOUT_RESOLUTION: ['RECONCILED','CONFLICT'],
  RECONCILED: [],
});

function requireBoundary(claims: Readonly<Record<string, CanonicalValue>>, expected: WitnessBoundary): void {
  if (claims.boundaryRole !== expected) throw new Error(`WITNESS_BOUNDARY_${expected}_REQUIRED`);
}

function requireTransport(claims: Readonly<Record<string, CanonicalValue>>): void {
  requireBoundary(claims, 'TRANSPORT');
  requiredString(claims, 'routeId');
  const transportKind = claims.transportKind;
  if (typeof transportKind !== 'string' || !(WITNESS_TRANSPORTS as readonly string[]).includes(transportKind)) {
    throw new Error('WITNESS_INVALID_TRANSPORT_KIND');
  }
}

function requiredString(claims: Readonly<Record<string, CanonicalValue>>, key: string): string {
  const value = claims[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`WITNESS_MISSING_${key.toUpperCase()}`);
  return value;
}

function validateStateEvidence(input: WitnessEvidenceInput, chain: readonly WitnessEvidence[]): void {
  const c = input.claims;
  switch (input.state) {
    case 'DETECTED':
      if (input.evidenceClass !== 'OBSERVED_FACT' && input.evidenceClass !== 'MACHINE_ASSERTION') throw new Error('WITNESS_DETECTION_CLASS_INVALID');
      requireBoundary(c, 'SENSOR_OR_SOURCE'); requiredString(c, 'sourceId'); break;
    case 'COMMITTED_LOCAL': requireBoundary(c, 'ZUNGUN_WITNESS'); requiredString(c, 'localCommitRef'); break;
    case 'CUSTODY_ACCEPTED': requireTransport(c); requiredString(c, 'custodyRef'); break;
    case 'DELIVERED_DURABLY': requireBoundary(c, 'RECEIVER'); requiredString(c, 'receiverId'); requiredString(c, 'durableReceiptRef'); break;
    case 'OWNED_BY_RESPONDER':
      if (input.evidenceClass !== 'HUMAN_ATTESTATION') throw new Error('WITNESS_OWNERSHIP_REQUIRES_HUMAN_ATTESTATION');
      requireBoundary(c, 'RESPONDER'); requiredString(c, 'responderId'); requiredString(c, 'ownershipRef'); break;
    case 'ACTION_STARTED':
      if (input.evidenceClass !== 'HUMAN_ATTESTATION') throw new Error('WITNESS_ACTION_REQUIRES_HUMAN_ATTESTATION');
      requireBoundary(c, 'RESPONDER'); requiredString(c, 'actionRef'); break;
    case 'CONDITION_RECHECKED': requireBoundary(c, 'SENSOR_OR_SOURCE'); requiredString(c, 'recheckRef'); requiredString(c, 'conditionStatus'); break;
    case 'RESOLVED':
      requireBoundary(c, 'RESPONDER'); requiredString(c, 'resolutionRef');
      if (!chain.some((item) => item.state === 'CONDITION_RECHECKED')) throw new Error('WITNESS_RESOLUTION_REQUIRES_RECHECK');
      break;
    case 'RECONCILED': requiredString(c, 'reconciliationCode'); break;
    case 'UNKNOWN': requiredString(c, 'unknownReason'); break;
    case 'CONFLICT': requiredString(c, 'conflictReason'); break;
    case 'EXPIRED_WITHOUT_RESOLUTION': if (typeof c.expiresAtMs !== 'number') throw new Error('WITNESS_MISSING_EXPIRESATMS'); break;
  }
}

export function appendWitnessEvidence(chain: readonly WitnessEvidence[], input: WitnessEvidenceInput): WitnessEvidence {
  if (!ID.test(input.incidentId) || !ID.test(input.evidenceId) || !ID.test(input.emitterId)) throw new Error('WITNESS_INVALID_ID');
  if (!ID.test(input.authorizationScope) || !ID.test(input.provenance)) throw new Error('WITNESS_INVALID_PROVENANCE');
  if (!REASON.test(input.reasonCode)) throw new Error('WITNESS_INVALID_REASON_CODE');
  if (!Number.isSafeInteger(input.observedAtMs) || !Number.isSafeInteger(input.monotonicMs) || input.observedAtMs < 0 || input.monotonicMs < 0) throw new Error('WITNESS_INVALID_TIME');
  if (chain.some((item) => item.evidenceId === input.evidenceId)) throw new Error('WITNESS_DUPLICATE_EVIDENCE_ID');
  if (chain.some((item) => item.incidentId !== input.incidentId)) throw new Error('WITNESS_INCIDENT_MISMATCH');
  const previous = chain.at(-1) ?? null;
  const allowed = TRANSITIONS[previous?.state ?? 'START'] ?? [];
  if (!allowed.includes(input.state)) throw new Error('WITNESS_INVALID_STATE_TRANSITION');
  if (previous && input.monotonicMs < previous.monotonicMs) throw new Error('WITNESS_MONOTONIC_REGRESSION');
  validateStateEvidence(input, chain);
  const body = { schemaVersion: WITNESS_SCHEMA_VERSION, incidentId: input.incidentId, evidenceId: input.evidenceId, state: input.state, evidenceClass: input.evidenceClass, emitterId: input.emitterId, authorizationScope: input.authorizationScope, observedAtMs: input.observedAtMs, monotonicMs: input.monotonicMs, provenance: input.provenance, reasonCode: input.reasonCode, claims: input.claims, previousState: previous?.state ?? null, previousHash: previous?.evidenceHash ?? null, chainPosition: chain.length } satisfies Omit<WitnessEvidence, 'evidenceHash'>;
  const evidenceHash = `sha256:${sha256Hex(canonicalize(body as unknown as CanonicalValue))}`;
  return Object.freeze({ ...body, evidenceHash });
}

export function verifyWitnessChain(chain: readonly WitnessEvidence[]): { readonly ok: true; readonly state: WitnessState | null } {
  const rebuilt: WitnessEvidence[] = [];
  for (const item of chain) {
    const { schemaVersion, previousState, previousHash, chainPosition, evidenceHash, ...input } = item;
    if (schemaVersion !== WITNESS_SCHEMA_VERSION || chainPosition !== rebuilt.length) throw new Error('WITNESS_CHAIN_POSITION_INVALID');
    const expected = appendWitnessEvidence(rebuilt, input);
    if (expected.previousState !== previousState || expected.previousHash !== previousHash || expected.evidenceHash !== evidenceHash) throw new Error('WITNESS_CHAIN_TAMPERED');
    rebuilt.push(item);
  }
  return Object.freeze({ ok: true, state: rebuilt.at(-1)?.state ?? null });
}

export interface WitnessReconciliation { readonly state: 'RECONCILED' | 'UNKNOWN' | 'CONFLICT'; readonly code: string; readonly durableReceiverProof: boolean; readonly unresolved: readonly string[]; }

export function reconcileWitnessHistories(sender: readonly WitnessEvidence[], receiver: readonly WitnessEvidence[]): WitnessReconciliation {
  verifyWitnessChain(sender); verifyWitnessChain(receiver);
  const senderHashes = new Set(sender.map((item) => item.evidenceHash));
  const conflicting = sender.some((left) => receiver.some((right) => left.chainPosition === right.chainPosition && left.evidenceHash !== right.evidenceHash));
  if (conflicting) return Object.freeze({ state: 'CONFLICT', code: 'DIVERGENT_CHAIN_HISTORY', durableReceiverProof: receiver.some((x) => x.state === 'DELIVERED_DURABLY'), unresolved: Object.freeze(['CHAIN_DIVERGENCE']) });
  const durable = receiver.some((item) => item.state === 'DELIVERED_DURABLY');
  const missingReceiver = receiver.filter((item) => !senderHashes.has(item.evidenceHash));
  if (durable && missingReceiver.length > 0) return Object.freeze({ state: 'RECONCILED', code: 'RECEIVER_DURABLE_EVIDENCE_RECOVERED', durableReceiverProof: true, unresolved: Object.freeze([]) });
  const unresolved = [...sender, ...receiver].filter((item) => ['UNKNOWN','CONFLICT','EXPIRED_WITHOUT_RESOLUTION'].includes(item.state));
  if (unresolved.length > 0) return Object.freeze({ state: unresolved.some((x) => x.state === 'CONFLICT') ? 'CONFLICT' : 'UNKNOWN', code: 'UNCERTAINTY_REMAINS', durableReceiverProof: durable, unresolved: Object.freeze(unresolved.map((x) => x.reasonCode)) });
  return Object.freeze({ state: 'RECONCILED', code: 'HISTORIES_CONSISTENT', durableReceiverProof: durable, unresolved: Object.freeze([]) });
}

export interface ProofBundleRedaction { readonly originalSha256: string; readonly reasonCode: string }
export interface ProofBundleFile { readonly path: string; readonly sha256: string; readonly content: string; readonly redaction?: ProofBundleRedaction }
export interface IncidentProofBundle { readonly schemaVersion: 'zungun-proof-bundle/1'; readonly incidentId: string; readonly files: readonly ProofBundleFile[]; readonly manifestSha256: string; }

function buildBundleManifest(incidentId: string, files: readonly ProofBundleFile[]): string {
  return canonicalize({
    schemaVersion: 'zungun-proof-bundle/1', incidentId,
    objects: files.map((file) => ({ path: file.path, sha256: file.sha256, redaction: file.redaction ? { originalSha256: file.redaction.originalSha256, reasonCode: file.redaction.reasonCode } : null })),
  } as CanonicalValue);
}

export function buildIncidentProofBundle(chain: readonly WitnessEvidence[]): IncidentProofBundle {
  verifyWitnessChain(chain);
  if (chain.length === 0) throw new Error('WITNESS_EMPTY_INCIDENT');
  const incidentId = chain[0]!.incidentId;
  const evidence = canonicalize(chain as unknown as CanonicalValue);
  const summary = [`Incident: ${incidentId}`,`Final evidence state: ${chain.at(-1)!.state}`,`Evidence records: ${chain.length}`,'Hashes/signatures prove integrity or attributed claims only; they do not prove the underlying physical-world assertion is true.'].join('\n');
  const base = [
    { path: 'evidence-chain.json', content: evidence },
    { path: 'human-report.txt', content: summary },
    { path: 'verification-tool-or-instructions/README.txt', content: 'Verify every manifest hash, then verify evidence-chain previousHash links and transition preconditions using zungun-witness/1.' },
  ].map((file) => Object.freeze({ ...file, sha256: `sha256:${sha256Hex(file.content)}` }));
  const manifest = buildBundleManifest(incidentId, base);
  const manifestFile = Object.freeze({ path: 'manifest.json', content: manifest, sha256: `sha256:${sha256Hex(manifest)}` });
  const files = Object.freeze([...base, manifestFile].sort((a,b) => a.path.localeCompare(b.path)));
  return Object.freeze({ schemaVersion: 'zungun-proof-bundle/1', incidentId, files, manifestSha256: manifestFile.sha256 });
}

export function verifyIncidentProofBundle(bundle: IncidentProofBundle): { readonly ok: true; readonly finalState: WitnessState | null } {
  if (bundle.schemaVersion !== 'zungun-proof-bundle/1') throw new Error('BUNDLE_UNSUPPORTED_SCHEMA');
  const byPath = new Map(bundle.files.map((file) => [file.path, file]));
  const manifestFile = byPath.get('manifest.json'); const evidenceFile = byPath.get('evidence-chain.json');
  if (!manifestFile || !evidenceFile) throw new Error('BUNDLE_REQUIRED_FILE_MISSING');
  if (`sha256:${sha256Hex(manifestFile.content)}` !== bundle.manifestSha256) throw new Error('BUNDLE_MANIFEST_TAMPERED');
  const manifest = JSON.parse(manifestFile.content) as { schemaVersion?: string; incidentId?: string; objects?: Array<{path:string;sha256:string;redaction?:ProofBundleRedaction|null}> };
  if (manifest.schemaVersion !== bundle.schemaVersion || manifest.incidentId !== bundle.incidentId || !Array.isArray(manifest.objects)) throw new Error('BUNDLE_MANIFEST_INVALID');
  for (const object of manifest.objects) {
    const file = byPath.get(object.path);
    if (!file || `sha256:${sha256Hex(file.content)}` !== object.sha256 || file.sha256 !== object.sha256) throw new Error('BUNDLE_OBJECT_TAMPERED');
    const declared = object.redaction ?? null; const actual = file.redaction ?? null;
    if (canonicalize((declared ?? null) as unknown as CanonicalValue) !== canonicalize((actual ?? null) as unknown as CanonicalValue)) throw new Error('BUNDLE_REDACTION_DECLARATION_MISMATCH');
    if (actual) {
      const marker = JSON.parse(file.content) as { schemaVersion?: string; originalSha256?: string; reasonCode?: string };
      if (marker.schemaVersion !== 'zungun-redaction/1' || marker.originalSha256 !== actual.originalSha256 || marker.reasonCode !== actual.reasonCode) throw new Error('BUNDLE_REDACTION_MARKER_INVALID');
    }
  }
  const chain = JSON.parse(evidenceFile.content) as WitnessEvidence[];
  if (chain.some((item) => item.incidentId !== bundle.incidentId)) throw new Error('BUNDLE_INCIDENT_MISMATCH');
  const verified = verifyWitnessChain(chain);
  return Object.freeze({ ok: true, finalState: verified.state });
}

export function redactIncidentProofBundle(bundle: IncidentProofBundle, paths: readonly string[], reasonCode: string): IncidentProofBundle {
  verifyIncidentProofBundle(bundle);
  if (!REASON.test(reasonCode)) throw new Error('BUNDLE_INVALID_REDACTION_REASON');
  const targets = new Set(paths);
  if (targets.has('manifest.json') || targets.has('evidence-chain.json')) throw new Error('BUNDLE_CRITICAL_FILE_REDACTION_FORBIDDEN');
  const bodyFiles = bundle.files.filter((file) => file.path !== 'manifest.json').map((file) => {
    if (!targets.has(file.path)) return file;
    const redaction = Object.freeze({ originalSha256: file.sha256, reasonCode });
    const content = canonicalize({ schemaVersion: 'zungun-redaction/1', originalSha256: file.sha256, reasonCode } as CanonicalValue);
    return Object.freeze({ path: file.path, content, sha256: `sha256:${sha256Hex(content)}`, redaction });
  });
  for (const path of targets) if (!bodyFiles.some((file) => file.path === path)) throw new Error('BUNDLE_REDACTION_TARGET_MISSING');
  const manifest = buildBundleManifest(bundle.incidentId, bodyFiles);
  const manifestFile = Object.freeze({ path: 'manifest.json', content: manifest, sha256: `sha256:${sha256Hex(manifest)}` });
  const files = Object.freeze([...bodyFiles, manifestFile].sort((a,b) => a.path.localeCompare(b.path)));
  return Object.freeze({ schemaVersion: bundle.schemaVersion, incidentId: bundle.incidentId, files, manifestSha256: manifestFile.sha256 });
}

export function runBlackoutDrill(incidentId = 'blackout-drill-1'): Readonly<Record<string,string>> {
  let chain: WitnessEvidence[] = [];
  const add = (state: WitnessState, evidenceClass: EvidenceClass, claims: Readonly<Record<string,CanonicalValue>>, reasonCode: string) => { const next = appendWitnessEvidence(chain, { incidentId, evidenceId: `ev-${chain.length + 1}`, state, evidenceClass, emitterId: state.includes('OWNED') || state === 'ACTION_STARTED' ? 'responder:ops' : 'device:drill', authorizationScope: 'witness:append', observedAtMs: 1_000 + chain.length, monotonicMs: chain.length, provenance: state === 'DELIVERED_DURABLY' ? 'receiver:local' : 'drill:local', reasonCode, claims }); chain = [...chain, next]; };
  add('DETECTED','OBSERVED_FACT',{boundaryRole:'SENSOR_OR_SOURCE',sourceId:'sensor:synthetic'},'DRILL_DETECTED');
  add('COMMITTED_LOCAL','MACHINE_ASSERTION',{boundaryRole:'ZUNGUN_WITNESS',localCommitRef:'queue:1'},'LOCAL_DURABLE_COMMIT');
  add('CUSTODY_ACCEPTED','MACHINE_ASSERTION',{boundaryRole:'TRANSPORT',transportKind:'STORE_FORWARD',routeId:'route:alternate',custodyRef:'store-forward:1'},'ALTERNATE_CUSTODY');
  add('DELIVERED_DURABLY','MACHINE_ASSERTION',{boundaryRole:'RECEIVER',receiverId:'receiver:local',durableReceiptRef:'receipt:1'},'RECEIVER_DURABLE');
  add('OWNED_BY_RESPONDER','HUMAN_ATTESTATION',{boundaryRole:'RESPONDER',responderId:'ops',ownershipRef:'ack:1'},'RESPONDER_OWNED');
  add('UNKNOWN','DERIVED_CONCLUSION',{unknownReason:'ACTION_EVIDENCE_MISSING'},'PARTITION_AFTER_OWNERSHIP');
  verifyWitnessChain(chain);
  return Object.freeze({ DETECTED:'PROVED', DELIVERED_DURABLY:'PROVED', OWNED_BY_RESPONDER:'PROVED', ACTION_STARTED:'UNKNOWN', CONDITION_RECHECKED:'NOT_PROVED', RESOLVED:'NOT_PROVED', FINAL_STATE:chain.at(-1)!.state });
}
