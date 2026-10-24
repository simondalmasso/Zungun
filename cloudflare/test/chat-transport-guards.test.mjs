import assert from 'node:assert/strict';
import test from 'node:test';
import '../public/chat/transport-guards.js';

const guards=globalThis.ZungunTransportGuards;

test('a successful Internet request cannot overwrite satellite-only status',()=>{
  assert.deepEqual(guards.connectionState('SATELLITE_ONLY','Conectado',true),{label:'Satélite no verificado',connected:false});
});

test('ordinary Internet status is unchanged outside satellite-only mode',()=>{
  assert.deepEqual(guards.connectionState('INTERNET','Conectado',true),{label:'Conectado',connected:true});
  assert.deepEqual(guards.connectionState('SATELLITE_ONLY','Sin conexión',false),{label:'Sin conexión',connected:false});
});

test('satellite-only mode blocks Internet outbox sends even while online',()=>{
  assert.equal(guards.allowsInternetSend('SATELLITE_ONLY',true),false);
  assert.equal(guards.allowsInternetSend('SATELLITE_ONLY',false),false);
  assert.equal(guards.allowsInternetSend('INTERNET',true),true);
  assert.equal(guards.allowsInternetSend('INTERNET',false),false);
});
