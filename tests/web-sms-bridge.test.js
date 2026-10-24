import assert from 'node:assert/strict';
import test from 'node:test';
await import('../cloudflare/public/chat/sms-auth.js');
await import('../cloudflare/public/chat/sms-bridge.js');
const bridge=globalThis.ZungunSmsBridge;
const auth=globalThis.ZungunSmsAuth;

test('SMS envelope round-trips Unicode and preserves the idempotency key',()=>{
  const input={conversationId:'conv_123',messageId:'msg_12345678-abcd',clientCreatedAtMs:1792843200000,body:'Hola, ¿llegó? ñ 🛰️'};
  assert.deepEqual(bridge.decodeEnvelope(bridge.encodeEnvelope(input)),input);
});

test('SMS envelope rejects malformed IDs, timestamps, and oversized messages',()=>{
  assert.throws(()=>bridge.encodeEnvelope({conversationId:'c',messageId:'bad',clientCreatedAtMs:1,body:'hola'}),/SMS_ENVELOPE_INVALID/);
  assert.throws(()=>bridge.decodeEnvelope('ZUNGUN-SMS/1|c|msg_12345678|NaN|aGk'),/SMS_ENVELOPE_INVALID/);
  assert.throws(()=>bridge.encodeEnvelope({conversationId:'c',messageId:'msg_12345678',clientCreatedAtMs:1,body:'x'.repeat(2001)}),/SMS_ENVELOPE_INVALID/);
});

test('gateway URL validation rejects embedded credentials and non-HTTP protocols',()=>{
  assert.equal(bridge.normalizeGatewayUrl('http://127.0.0.1:8080/'),'http://127.0.0.1:8080');
  assert.throws(()=>bridge.normalizeGatewayUrl('javascript:alert(1)'),/SMS_GATEWAY_URL_INVALID/);
  assert.throws(()=>bridge.normalizeGatewayUrl('http://user:pass@127.0.0.1:8080'),/SMS_GATEWAY_URL_INVALID/);
});

test('gateway acceptance is not misreported as handset delivery',async()=>{
  const memory=new Map([['zungun-sms-bridge-v1',JSON.stringify({gatewayUrl:'http://127.0.0.1:8080',username:'u',password:'p'})]]);
  const storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  let request;
  const client=bridge.createClient({storage,fetchImpl:async(url,options)=>{request={url,options};return {ok:true,status:202,json:async()=>({id:'gateway-id'})}}});
  const message={conversationId:'conv_123',messageId:'msg_12345678',clientCreatedAtMs:1,body:'test'};
  const authKey=auth.generateKey();
  const result=await client.send({phoneNumber:'+5491123456789',message,authKey});
  assert.equal(result.state,'ACCEPTED_BY_GATEWAY');
  assert.equal(result.deliveryConfirmed,false);
  assert.equal(request.url,'http://127.0.0.1:8080/messages');
  assert.deepEqual(JSON.parse(request.options.body).phoneNumbers,['+5491123456789']);
  assert.deepEqual(await auth.decodeAuthenticatedEnvelope(JSON.parse(request.options.body).textMessage.text,authKey),message);
  assert.equal(JSON.parse(request.options.body).id,'12345678');
  assert.equal(JSON.parse(request.options.body).withDeliveryReport,true);
});

test('network failure returns unknown outcome; caller must not blindly retry SMS',async()=>{
  const storage={getItem:()=>JSON.stringify({gatewayUrl:'http://127.0.0.1:8080',username:'u',password:'p'}),setItem(){},removeItem(){}};
  const client=bridge.createClient({storage,fetchImpl:async()=>{throw new TypeError('network unavailable')}});
  const message={conversationId:'c',messageId:'msg_12345678',clientCreatedAtMs:1,body:'hello'};
  await assert.rejects(()=>client.send({phoneNumber:'+5491123456789',message,authKey:auth.generateKey()}),e=>e.code==='SMS_SEND_UNKNOWN');
});

test('incoming SMS is accepted only with a valid peer MAC, expected phone and conversation; duplicates are rejected',async()=>{
  const memory=new Map();
  const storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  const message={conversationId:'conv_123',messageId:'msg_12345678',clientCreatedAtMs:1,body:'hola desde SMS'};
  const authKey=auth.generateKey();
  const incoming={type:'SMS',sender:'+5491123456789',contentPreview:await auth.encodeAuthenticatedEnvelope(message,authKey)};
  await assert.rejects(()=>bridge.acceptIncoming({incoming,expectedPhoneNumber:'+5491199999999',conversationId:'conv_123',storage,authKey}),/SMS_SENDER_NOT_AUTHORIZED/);
  await assert.rejects(()=>bridge.acceptIncoming({incoming,expectedPhoneNumber:'+5491123456789',conversationId:'conv_other',storage,authKey}),/SMS_CONVERSATION_MISMATCH/);
  assert.equal((await bridge.acceptIncoming({incoming,expectedPhoneNumber:'+5491123456789',conversationId:'conv_123',storage,authKey})).accepted,true);
  assert.deepEqual(await bridge.acceptIncoming({incoming,expectedPhoneNumber:'+5491123456789',conversationId:'conv_123',storage,authKey}),{accepted:false,reason:'DUPLICATE',messageId:'msg_12345678'});
  await assert.rejects(()=>bridge.acceptIncoming({incoming,expectedPhoneNumber:'+5491123456789',conversationId:'conv_123',storage,authKey:auth.generateKey()}),/SMS_ENVELOPE_AUTH_FAILED/);
  const unauthenticated={...incoming,contentPreview:bridge.encodeEnvelope(message)};
  await assert.rejects(()=>bridge.acceptIncoming({incoming:unauthenticated,expectedPhoneNumber:'+5491123456789',conversationId:'conv_123',storage,authKey}),/SMS_ENVELOPE_INVALID/);
});

test('inbox client uses the local inbox endpoint and validates pagination',async()=>{
  const storage={getItem:()=>JSON.stringify({gatewayUrl:'http://127.0.0.1:8080/api',username:'u',password:'p'}),setItem(){},removeItem(){}};
  let request;
  const client=bridge.createClient({storage,fetchImpl:async(url,options)=>{request={url,options};return {ok:true,status:200,json:async()=>[{id:'in_1',type:'SMS',sender:'+5491123456789',contentPreview:'payload',createdAt:'2026-10-24T00:00:00Z'}]}}});
  const messages=await client.listIncoming({limit:25,offset:5,from:'2026-10-24T00:00:00Z'});
  assert.equal(request.url,'http://127.0.0.1:8080/api/inbox?type=SMS&limit=25&offset=5&from=2026-10-24T00%3A00%3A00.000Z');
  assert.equal(request.options.method,'GET');
  assert.equal(messages[0].id,'in_1');
  await assert.rejects(()=>client.listIncoming({limit:501}),/SMS_INBOX_PAGINATION_INVALID/);
});


test('authenticated SMS v2 envelopes reject tampering and malformed peer keys',async()=>{
  const message={conversationId:'conv_123',messageId:'msg_12345678',clientCreatedAtMs:1792843200000,body:'Hola, ¿llegó? ñ 🛰️'};
  const key=auth.generateKey();
  assert.match(key,/^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await auth.decodeAuthenticatedEnvelope(await auth.encodeAuthenticatedEnvelope(message,key),key),message);
  await assert.rejects(()=>auth.encodeAuthenticatedEnvelope(message,'short'),/SMS_AUTH_KEY_REQUIRED/);
  const signed=await auth.encodeAuthenticatedEnvelope(message,key);
  await assert.rejects(()=>auth.decodeAuthenticatedEnvelope(signed+'x',key),/SMS_ENVELOPE_INVALID/);
  const parts=signed.split('|');parts[1]='conv_other';
  await assert.rejects(()=>auth.decodeAuthenticatedEnvelope(parts.join('|'),key),/SMS_ENVELOPE_AUTH_FAILED/);
  await assert.rejects(()=>auth.decodeAuthenticatedEnvelope(signed,auth.generateKey()),/SMS_ENVELOPE_AUTH_FAILED/);
});

test('SMS sender requires an authenticated peer key before making a gateway request',async()=>{
  const storage={getItem:()=>JSON.stringify({gatewayUrl:'http://127.0.0.1:8080',username:'u',password:'p'}),setItem(){},removeItem(){}};
  let requests=0;
  const client=bridge.createClient({storage,fetchImpl:async()=>{requests++;return {ok:true,status:202,json:async()=>({})}}});
  await assert.rejects(()=>client.send({phoneNumber:'+5491123456789',message:{conversationId:'c',messageId:'msg_12345678',clientCreatedAtMs:1,body:'hello'}}),/SMS_AUTH_KEY_REQUIRED/);
  assert.equal(requests,0);
});
