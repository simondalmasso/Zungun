import assert from 'node:assert/strict';
import test from 'node:test';
import { LinkReceiverProxy, type LinkProxyRecord, type LinkProxyStore } from '../services/receiver/src/link-proxy.js';
import { validateTransportForTier } from '../packages/link-core/src/transport.js';

class MemoryStore implements LinkProxyStore {
  records = new Map<string,LinkProxyRecord>();
  get(id:string){return this.records.get(id)??null;}
  getByIdempotencyKey(k:string){return [...this.records.values()].find((r)=>r.idempotencyKey===k)??null;}
  insert(r:LinkProxyRecord){if(this.get(r.operationId)||this.getByIdempotencyKey(r.idempotencyKey))return false;this.records.set(r.operationId,r);return true;}
  update(r:LinkProxyRecord){this.records.set(r.operationId,r);}
}
const baseRoute={routeId:'r',targetOrigin:'https://api.example.com',pathPrefix:'/v1',allowedMethods:['POST'] as const,maxRequestBytes:4096,maxResponseBytes:4096,timeoutMs:1000,allowedRequestHeaders:['content-type']};
const baseRequest={operationId:'op-sec',idempotencyKey:'idem-sec',routeId:'r',method:'POST' as const,relativePath:'/mutate',headers:{'content-type':'application/json'},body:new TextEncoder().encode('{}'),createdAtMs:1};

function proxy(route=baseRoute){return new LinkReceiverProxy([route],new MemoryStore(),{async invoke(){return {status:202,headers:{},body:new TextEncoder().encode('{"secret":"must-not-persist"}')}}});}

test('security matrix blocks IPv6 local/private proxy targets',()=>{
  for(const targetOrigin of ['https://[::1]','https://[fc00::1]','https://[fd12::1]','https://[fe80::1]']) {
    assert.throws(()=>proxy({...baseRoute,targetOrigin}),/PRIVATE_TARGET/);
  }
});

test('security matrix blocks double-encoded traversal and unsafe route prefixes',async()=>{
  await assert.rejects(()=>proxy().execute({...baseRequest,relativePath:'/%252e%252e/admin'}),/PATH_INVALID/);
  assert.throws(()=>proxy({...baseRoute,pathPrefix:'/v1/../admin'}),/PATH_PREFIX_INVALID/);
});

test('security matrix rejects header injection and excessive header sets',async()=>{
  await assert.rejects(()=>proxy().execute({...baseRequest,headers:{'content-type':'application/json\r\nx-evil: yes'}}),/HEADER_INJECTION/);
  const headers=Object.fromEntries(Array.from({length:33},(_,i)=>[`x-${i}`,'x']));
  await assert.rejects(()=>proxy().execute({...baseRequest,headers}),/TOO_MANY_HEADERS/);
});

test('proxy evidence stores response hash but not raw upstream body',async()=>{
  const result=await proxy().execute(baseRequest,2);
  assert.equal(result.record.state,'UPSTREAM_ACCEPTED');
  assert.equal(result.record.responseBody,null);
  assert.equal(result.record.responseSha256?.length,64);
});

test('assurance downgrade fails closed when durable receipt/query capability is missing',()=>{
  const cap={adapterId:'http',available:true,reachabilityClass:'INTERNET' as const,maxPayloadBytes:null,supportsDurableReceipt:false,supportsReceiverQuery:false,supportsResume:false,supportsNetworkBinding:true,supportsHedging:false};
  assert.throws(()=>validateTransportForTier(cap,'L1_RECEIVER_PROXY'),/DURABLE_RECEIPT_REQUIRED/);
  assert.throws(()=>validateTransportForTier({...cap,supportsDurableReceipt:true},'L2_NATIVE_RECEIVER_EFFECT'),/RECEIVER_QUERY_REQUIRED/);
});
