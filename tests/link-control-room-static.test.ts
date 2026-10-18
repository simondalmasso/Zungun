import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Control Room Link surface exposes required operation fields and evidence boundary',()=>{
  const html=readFileSync('apps/control-room/public/link.html','utf8');
  const js=readFileSync('apps/control-room/public/link-view.js','utf8');
  for(const field of ['CURRENT_OPERATION_STATE','CURRENT_LINK_PLAN','CRITICAL_BYTES_STATUS','DEFERRED_BYTES_STATUS','CURRENT_ASSURANCE_TIER','RECONCILIATION_STATUS','RECEIPT_EFFECT_STATE','WITNESS_STATE','FULL_EVIDENCE_COMPLETE']) assert.ok(js.includes(field),field);
  assert.ok(html.includes('a plan is not a send'));
  assert.ok(js.includes("terminal&&!uncertain&&(!deferred||deferredComplete)&&(!reconStart||Boolean(reconResult))"));
  assert.ok(!js.toLowerCase().includes('localstorage'));
});
