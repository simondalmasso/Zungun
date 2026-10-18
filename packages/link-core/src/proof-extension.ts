import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical.js';
import type { LinkDecisionRecord } from './witness-link.js';

export interface IncidentProofFileLike {
  readonly path: string;
  readonly sha256: string;
  readonly content: string;
  readonly redaction?: Readonly<{ originalSha256: string; reasonCode: string }>;
}

export interface IncidentProofBundleLike {
  readonly schemaVersion: 'zungun-proof-bundle/1';
  readonly incidentId: string;
  readonly files: readonly IncidentProofFileLike[];
  readonly manifestSha256: string;
}

export interface LinkProofAttachmentInput {
  readonly decisionRecords: readonly LinkDecisionRecord[];
  readonly transportAttempts: readonly Readonly<Record<string, unknown>>[];
  readonly deferredObjectManifest: readonly Readonly<Record<string, unknown>>[];
  readonly reconciliation: Readonly<Record<string, unknown>>;
}

const REQUIRED_LINK_PATHS = Object.freeze([
  'link/decision-records.json',
  'link/transport-attempts.json',
  'link/deferred-object-manifest.json',
  'link/reconciliation.json',
  'link/README.txt',
] as const);

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sensitive(value: unknown, path = ''): void {
  if (typeof value === 'string') {
    if (/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/i.test(value)) throw new Error('LINK_PROOF_SECRET_VALUE_REFUSED');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error('LINK_PROOF_ARRAY_TOO_LARGE');
    value.forEach((item, index) => sensitive(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/(authorization|access.?token|refresh.?token|private.?key|password|cookie|card.?number|bearer)/i.test(key)) {
      throw new Error(`LINK_PROOF_SENSITIVE_FIELD_REFUSED:${path}${key}`);
    }
    sensitive(item, `${path}${key}.`);
  }
}

function verifyBase(bundle: IncidentProofBundleLike): void {
  if (bundle.schemaVersion !== 'zungun-proof-bundle/1' || !bundle.incidentId) throw new Error('LINK_PROOF_BASE_INVALID');
  const byPath = new Map(bundle.files.map((file) => [file.path, file]));
  if (byPath.size !== bundle.files.length) throw new Error('LINK_PROOF_DUPLICATE_PATH');
  const manifestFile = byPath.get('manifest.json');
  if (!manifestFile || sha256(manifestFile.content) !== bundle.manifestSha256 || manifestFile.sha256 !== bundle.manifestSha256) {
    throw new Error('LINK_PROOF_BASE_MANIFEST_INVALID');
  }
  const manifest = JSON.parse(manifestFile.content) as { schemaVersion?: string; incidentId?: string; objects?: Array<{path:string;sha256:string}> };
  if (manifest.schemaVersion !== bundle.schemaVersion || manifest.incidentId !== bundle.incidentId || !Array.isArray(manifest.objects)) {
    throw new Error('LINK_PROOF_BASE_MANIFEST_INVALID');
  }
  for (const declared of manifest.objects) {
    const file = byPath.get(declared.path);
    if (!file || sha256(file.content) !== declared.sha256 || file.sha256 !== declared.sha256) throw new Error('LINK_PROOF_BASE_OBJECT_TAMPERED');
  }
}

function materialize(path: string, value: unknown): IncidentProofFileLike {
  sensitive(value);
  const content = typeof value === 'string' ? value : canonicalJson(value);
  return Object.freeze({ path, content, sha256: sha256(content) });
}

export function attachLinkEvidence(bundle: IncidentProofBundleLike, input: LinkProofAttachmentInput): IncidentProofBundleLike {
  verifyBase(bundle);
  if (input.decisionRecords.some((record) => record.operationId !== bundle.incidentId)) throw new Error('LINK_PROOF_CROSS_OPERATION');
  sensitive(input);
  const extras = [
    materialize('link/decision-records.json', input.decisionRecords),
    materialize('link/transport-attempts.json', input.transportAttempts),
    materialize('link/deferred-object-manifest.json', input.deferredObjectManifest),
    materialize('link/reconciliation.json', input.reconciliation),
    materialize('link/README.txt', 'Link files are supporting operational evidence. PLAN_CREATED != SENT, SENT != RECEIVED, RECEIVED != APPLICATION_EFFECT, and critical-core completion does not imply required-evidence completion.'),
  ];
  const base = bundle.files.filter((file) => file.path !== 'manifest.json' && !file.path.startsWith('link/'));
  const bodyFiles = Object.freeze([...base, ...extras].sort((a, b) => a.path.localeCompare(b.path)));
  const manifestContent = canonicalJson({
    schemaVersion: bundle.schemaVersion,
    incidentId: bundle.incidentId,
    objects: bodyFiles.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      redaction: file.redaction ? { originalSha256: file.redaction.originalSha256, reasonCode: file.redaction.reasonCode } : null,
    })),
  });
  const manifestFile = Object.freeze({ path: 'manifest.json', content: manifestContent, sha256: sha256(manifestContent) });
  return Object.freeze({
    schemaVersion: bundle.schemaVersion,
    incidentId: bundle.incidentId,
    files: Object.freeze([...bodyFiles, manifestFile].sort((a, b) => a.path.localeCompare(b.path))),
    manifestSha256: manifestFile.sha256,
  });
}

export function verifyLinkEvidenceAttachment(bundle: IncidentProofBundleLike): { readonly ok: true; readonly paths: readonly string[] } {
  verifyBase(bundle);
  const byPath = new Map(bundle.files.map((file) => [file.path, file]));
  for (const path of REQUIRED_LINK_PATHS) {
    const file = byPath.get(path);
    if (!file || sha256(file.content) !== file.sha256) throw new Error('LINK_PROOF_REQUIRED_FILE_MISSING_OR_TAMPERED');
    sensitive(file.content);
  }
  const records = JSON.parse(byPath.get('link/decision-records.json')!.content) as LinkDecisionRecord[];
  if (!Array.isArray(records) || records.some((record) => record.operationId !== bundle.incidentId)) throw new Error('LINK_PROOF_DECISIONS_INVALID');
  return Object.freeze({ ok: true, paths: REQUIRED_LINK_PATHS });
}
