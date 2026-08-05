import test from 'node:test';
import assert from 'node:assert/strict';
import { StaticPrincipalAuthorizer, TokenAuthorizer } from '../services/receiver/src/auth.js';

const request = (value: string) => ({ headers: { authorization: value } } as any);

test('single-token compatibility adapter is least privilege by default', () => {
  const authorizer = new TokenAuthorizer('1234567890abcdef');
  assert.deepEqual(authorizer.authorize(request('Bearer 1234567890abcdef')).roles, ['ingest']);
  assert.throws(
    () => authorizer.authorize(request('Bearer 1234567890abcdef'), 'keys:manage'),
    /FORBIDDEN/,
  );
});

test('roles enforce route permissions and deny by default', () => {
  const authorizer = new StaticPrincipalAuthorizer([
    { subject: 'ingest', token: 'ingest-token-123456789', roles: ['ingest'] },
    { subject: 'worker', token: 'worker-token-123456789', roles: ['worker'] },
    { subject: 'reviewer', token: 'reviewer-token-1234567', roles: ['reviewer'] },
    { subject: 'admin', token: 'admin-token-1234567890', roles: ['admin'] },
  ]);
  assert.equal(authorizer.require(request('Bearer ingest-token-123456789'), 'operations:ingest').subject, 'ingest');
  assert.throws(() => authorizer.require(request('Bearer ingest-token-123456789'), 'operations:effect'), /FORBIDDEN/);
  assert.throws(() => authorizer.require(request('Bearer worker-token-123456789'), 'reconciliation:resolve'), /FORBIDDEN/);
  assert.throws(() => authorizer.require(request('Bearer reviewer-token-1234567'), 'keys:manage'), /FORBIDDEN/);
  assert.equal(authorizer.require(request('Bearer admin-token-1234567890'), 'keys:manage').subject, 'admin');
});

test('wrong, malformed and unequal-length tokens fail', () => {
  const authorizer = new TokenAuthorizer('1234567890abcdef');
  assert.throws(() => authorizer.authorize(request('Bearer 0000000000000000')), /UNAUTHORIZED/);
  assert.throws(() => authorizer.authorize(request('1234567890abcdef')), /UNAUTHORIZED/);
  assert.throws(() => authorizer.authorize(request('Bearer x')), /UNAUTHORIZED/);
});

test('short configured token fails startup', () => {
  assert.throws(() => new TokenAuthorizer('short'), /at least 16/);
});
