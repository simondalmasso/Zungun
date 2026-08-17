import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export type Role = 'ingest' | 'reader' | 'worker' | 'reviewer' | 'admin';
export type Permission =
  | 'operations:ingest'
  | 'operations:read'
  | 'operations:claim'
  | 'operations:effect'
  | 'operations:cancel'
  | 'reconciliation:read'
  | 'reconciliation:resolve'
  | 'completeness:read'
  | 'completeness:declare'
  | 'keys:read'
  | 'keys:manage'
  | 'audit:read'
  | 'witness:ingest'
  | 'witness:read'
  | 'witness:attest'
  | 'witness:reconcile';

const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  ingest: Object.freeze(['operations:ingest', 'witness:ingest'] as const),
  reader: Object.freeze([
    'operations:read', 'reconciliation:read', 'completeness:read', 'keys:read', 'witness:read',
  ] as const),
  worker: Object.freeze([
    'operations:read', 'operations:claim', 'operations:effect', 'operations:cancel', 'keys:read',
    'witness:read', 'witness:attest',
  ] as const),
  reviewer: Object.freeze([
    'operations:read', 'reconciliation:read', 'reconciliation:resolve', 'completeness:read',
    'witness:read', 'witness:attest', 'witness:reconcile',
  ] as const),
  admin: Object.freeze([
    'operations:read', 'reconciliation:read', 'completeness:read', 'completeness:declare',
    'keys:read', 'keys:manage', 'audit:read', 'witness:read', 'witness:reconcile',
  ] as const),
});

export interface PrincipalDefinition { readonly subject: string; readonly token: string; readonly roles: readonly Role[]; }
export interface AuthContext { readonly subject: string; readonly roles: readonly Role[]; readonly permissions: readonly Permission[]; }
export interface IdentityProvider { authenticate(request: IncomingMessage): AuthContext; require(request: IncomingMessage, permission: Permission): AuthContext; }

function safeTokenEqual(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function permissionSet(roles: readonly Role[]): readonly Permission[] {
  return Object.freeze([...new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]))].sort());
}
function validatePrincipal(principal: PrincipalDefinition): Readonly<PrincipalDefinition> {
  if (!/^[A-Za-z0-9._:@/-]{1,128}$/.test(principal.subject)) throw new Error('invalid principal subject');
  if (principal.token.length < 16) throw new Error('API token must contain at least 16 characters');
  if (principal.roles.length < 1 || principal.roles.some((role) => !(role in ROLE_PERMISSIONS))) throw new Error('principal must contain recognized roles');
  return Object.freeze({ subject: principal.subject, token: principal.token, roles: Object.freeze([...new Set(principal.roles)]) });
}

export class StaticPrincipalAuthorizer implements IdentityProvider {
  private readonly principals: readonly Readonly<PrincipalDefinition>[];
  constructor(principals: readonly PrincipalDefinition[]) {
    if (principals.length < 1) throw new Error('at least one principal is required');
    this.principals = Object.freeze(principals.map(validatePrincipal));
    if (new Set(this.principals.map((p) => p.subject)).size !== this.principals.length) throw new Error('principal subjects must be unique');
    if (new Set(this.principals.map((p) => p.token)).size !== this.principals.length) throw new Error('principal tokens must be unique');
  }
  authenticate(request: IncomingMessage): AuthContext {
    const header = String(request.headers.authorization ?? '');
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
    const principal = this.principals.find((candidate) => safeTokenEqual(supplied, candidate.token));
    if (!principal) throw new Error('UNAUTHORIZED');
    return Object.freeze({ subject: principal.subject, roles: principal.roles, permissions: permissionSet(principal.roles) });
  }
  require(request: IncomingMessage, permission: Permission): AuthContext {
    const context = this.authenticate(request);
    if (!context.permissions.includes(permission)) throw new Error('FORBIDDEN');
    return context;
  }
}
export class TokenAuthorizer extends StaticPrincipalAuthorizer {
  constructor(token: string, roles: readonly Role[] = ['ingest']) { super([{ subject: 'local-principal', token, roles }]); }
  authorize(request: IncomingMessage, permission?: Permission): AuthContext { return permission ? this.require(request, permission) : this.authenticate(request); }
}
export function parsePrincipalConfiguration(value: string): readonly PrincipalDefinition[] {
  const raw = JSON.parse(value) as unknown;
  if (!Array.isArray(raw)) throw new Error('principal configuration must be an array');
  return Object.freeze(raw.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error('invalid principal configuration');
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.subject !== 'string' || typeof candidate.token !== 'string' || !Array.isArray(candidate.roles)) throw new Error('invalid principal configuration');
    return { subject: candidate.subject, token: candidate.token, roles: candidate.roles.map(String) as Role[] };
  }));
}
export function developmentPrincipals(tokenPrefix = 'local-development'): readonly PrincipalDefinition[] {
  return Object.freeze([
    { subject: 'local-ingest', token: `${tokenPrefix}-ingest-token`, roles: ['ingest'] },
    { subject: 'local-reader', token: `${tokenPrefix}-reader-token`, roles: ['reader'] },
    { subject: 'local-worker', token: `${tokenPrefix}-worker-token`, roles: ['worker'] },
    { subject: 'local-reviewer', token: `${tokenPrefix}-reviewer-token`, roles: ['reviewer'] },
    { subject: 'local-admin', token: `${tokenPrefix}-admin-token`, roles: ['admin'] },
  ]);
}
