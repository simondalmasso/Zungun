import assert from 'node:assert/strict';
import test from 'node:test';
await import('../cloudflare/public/chat/sms-bridge.js');
const bridge=globalThis.ZungunSmsBridge;

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
  const result=await client.send({phoneNumber:'+5491123456789',message});
  assert.equal(result.state,'ACCEPTED_BY_GATEWAY');
  assert.equal(result.deliveryConfirmed,false);
  assert.equal(request.url,'http://127.0.0.1:8080/messages');
  assert.deepEqual(JSON.parse(request.options.body).phoneNumbers,['+5491123456789']);
  assert.equal(JSON.parse(request.options.body).id,'12345678');
  assert.equal(JSON.parse(request.options.body).withDeliveryReport,true);
});

test('network failure returns unknown outcome; caller must not blindly retry SMS',async()=>{
  const storage={getItem:()=>JSON.stringify({gatewayUrl:'http://127.0.0.1:8080',username:'u',password:'p'}),setItem(){},removeItem(){}};
  const client=bridge.createClient({storage,fetchImpl:async()=>{throw new TypeError('network unavailable')}});
  await assert.rejects(()=>client.send({phoneNumber:'+5491123456789',message:{conversationId:'c',messageId:'msg_12345678',clientCreatedAtMs:1,body:'hello'}}),e=>e.code==='SMS_SEND_UNKNOWN');
});
