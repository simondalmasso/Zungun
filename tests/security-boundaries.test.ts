import test from 'node:test';import assert from 'node:assert/strict';import {TokenAuthorizer} from '../services/receiver/src/auth.js';
const request=(value:string)=>({headers:{authorization:value}} as any);
test('bearer token authorizes expected roles',()=>{const a=new TokenAuthorizer('1234567890abcdef');assert.ok(a.authorize(request('Bearer 1234567890abcdef')).roles.includes('admin'));});
test('wrong token fails',()=>assert.throws(()=>new TokenAuthorizer('1234567890abcdef').authorize(request('Bearer 0000000000000000')),/UNAUTHORIZED/));
test('missing bearer scheme fails',()=>assert.throws(()=>new TokenAuthorizer('1234567890abcdef').authorize(request('1234567890abcdef')),/UNAUTHORIZED/));
test('short configured token fails startup',()=>assert.throws(()=>new TokenAuthorizer('short'),/at least 16/));
test('token comparison handles unequal lengths',()=>assert.throws(()=>new TokenAuthorizer('1234567890abcdef').authorize(request('Bearer x')),/UNAUTHORIZED/));
