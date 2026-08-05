import type { IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export interface AuthContext { readonly subject: string; readonly roles: readonly ('operator'|'reviewer'|'admin')[]; }
export class TokenAuthorizer {
  constructor(private readonly token: string) { if (token.length < 16) throw new Error('API token must contain at least 16 characters'); }
  authorize(request: IncomingMessage): AuthContext {
    const header = String(request.headers.authorization ?? '');
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
    const a=Buffer.from(supplied); const b=Buffer.from(this.token);
    if (a.length !== b.length || !timingSafeEqual(a,b)) throw new Error('UNAUTHORIZED');
    return Object.freeze({ subject:'local-operator',roles:Object.freeze(['operator','reviewer','admin'] as const) });
  }
}
