import assert from 'node:assert/strict';
import test from 'node:test';
import { LinkReceiverProxy, type LinkProxyRecord, type LinkProxyStore } from '../services/receiver/src/link-proxy.js';

class MemoryStore implements LinkProxyStore {
  records = new Map<string,LinkProxyRecord>();
  get(id:string){return this.records.get(id)??null;} getByIdempotencyKey(k:string){return [...this.records.values()].find((r)=>r.idempotencyKey===k)??null;}
  insert(r:LinkProxyRecord){if(this.get(r.operationId)||this.getByIdempotencyKey(r.idempotencyKey))return false;this.records.set(r.operationId,r);return true;} update(r:LinkProxyRecord){this.records.set(r.operationId,r);}
}
const route={routeId:'workorders',targetOrigin:'https://api.example.com',pathPrefix:'/v1',allowedMethods:['POST'] as const,maxRequestBytes:4096,maxResponseBytes:4096,timeoutMs:1000,allowedRequestHeaders:['content-type','if-match']};
const req={operationId:'op-1',idempotencyKey:'idem-op-1',routeId:'workorders',method:'POST' as const,relativePath:'/close',headers:{'content-type':'application/json',authorization:'secret','x-evil':'no'},body:new TextEncoder().encode('{"closed":true}'),createdAtMs:1};

test('L1 proxy persists idempotency before invoking and strips caller credentials', async()=>{
  const store=new MemoryStore();let seen:any=null;const proxy=new LinkReceiverProxy([route],store,{async invoke(input){seen=input;assert.equal(store.get('op-1')?.state,'PERSISTED');return {status:202,headers:{},body:new TextEncoder().encode('{"ok":true}')}}});
  const result=await proxy.execute(req,2);assert.equal(result.record.state,'UPSTREAM_ACCEPTED');assert.equal(seen.headers.authorization,undefined);assert.equal(seen.headers['idempotency-key'],'idem-op-1');
});

test('L1 proxy duplicate is idempotent but mismatched operation conflicts',async()=>{
 const store=new MemoryStore();let calls=0;const proxy=new LinkReceiverProxy([route],store,{async invoke(){calls++;return {status:202,headers:{},body:new Uint8Array()}}});
 await proxy.execute(req,2);const duplicate=await proxy.execute(req,3);assert.equal(duplicate.duplicate,true);assert.equal(calls,1);
 await assert.rejects(()=>proxy.execute({...req,body:new TextEncoder().encode('different')},4),/LINK_PROXY_IDEMPOTENCY_CONFLICT/);
});

test('L1 proxy lost/ambiguous upstream response stays UNKNOWN until query recovers it',async()=>{
 const store=new MemoryStore();const proxy=new LinkReceiverProxy([route],store,{async invoke(){throw new Error('ECONNRESET')},async query(){return 'APPLIED'}});
 const first=await proxy.execute(req,2);assert.equal(first.record.state,'UNKNOWN');const resolved=await proxy.reconcile('op-1',3);assert.equal(resolved?.state,'UPSTREAM_ACCEPTED');
});

test('L1 proxy refuses SSRF-like private origins and traversal',async()=>{
 assert.throws(()=>new LinkReceiverProxy([{...route,targetOrigin:'https://127.0.0.1'}],new MemoryStore(),{async invoke(){throw new Error()}}),/PRIVATE_TARGET/);
 const proxy=new LinkReceiverProxy([route],new MemoryStore(),{async invoke(){throw new Error()}});await assert.rejects(()=>proxy.execute({...req,relativePath:'/../admin'}),/PATH_INVALID/);
});

test('SqliteLinkProxyStore bootstraps durable schema and survives store recreation',async()=>{
  const { DatabaseSync } = await import('node:sqlite');
  const db=new DatabaseSync(':memory:');
  const { SqliteLinkProxyStore }=await import('../services/receiver/src/link-proxy.js');
  const store=new SqliteLinkProxyStore(db);
  const record={operationId:'op-sql',idempotencyKey:'idem-sql',routeId:'erp',requestSha256:'abc',state:'PERSISTED' as const,upstreamStatus:null,responseSha256:null,responseBody:null,createdAtMs:1,updatedAtMs:1};
  assert.equal(store.insert(record),true);
  const reopened=new SqliteLinkProxyStore(db);
  assert.equal(reopened.get('op-sql')?.idempotencyKey,'idem-sql');
  db.close();
});
