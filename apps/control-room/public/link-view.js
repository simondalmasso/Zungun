const $=(id)=>document.getElementById(id);
const esc=(value)=>String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const token=()=>sessionStorage.getItem('zungun.token')??'';
async function api(path){const r=await fetch(path,{headers:{authorization:`Bearer ${token()}`}});const v=await r.json();if(!r.ok)throw new Error(v?.error??`HTTP_${r.status}`);return v;}
const LINK_KINDS=new Set(['LINK_SNAPSHOT_OBSERVED','TRANSMISSION_PLAN_CREATED','CRITICAL_CORE_SENT','HEAVY_OBJECT_DEFERRED','TRANSPORT_PATH_SELECTED','PATH_CHANGED','RECONCILIATION_STARTED','RECONCILIATION_RESULT','DEFERRED_TRANSFER_STARTED','DEFERRED_TRANSFER_CHECKPOINT','DEFERRED_TRANSFER_COMPLETED','PREFETCH_COMPLETED']);
function safeJson(value){try{return JSON.parse(String(value??'{}'));}catch{return {};}}
function derive(operation,witness){
  const evidence=(operation.evidence??[]).filter((e)=>LINK_KINDS.has(e.kind));
  const plan=[...evidence].reverse().find((e)=>e.kind==='TRANSMISSION_PLAN_CREATED');
  const deferred=evidence.some((e)=>['HEAVY_OBJECT_DEFERRED','DEFERRED_TRANSFER_STARTED','DEFERRED_TRANSFER_CHECKPOINT'].includes(e.kind));
  const deferredComplete=evidence.some((e)=>e.kind==='DEFERRED_TRANSFER_COMPLETED');
  const reconStart=evidence.some((e)=>e.kind==='RECONCILIATION_STARTED');
  const reconResult=[...evidence].reverse().find((e)=>e.kind==='RECONCILIATION_RESULT');
  const finalWitness=witness.chain?.at(-1)?.state??'NO_WITNESS_EVIDENCE';
  const uncertain=['UNKNOWN','CONFLICT','EXPIRED_WITHOUT_RESOLUTION'].includes(finalWitness);
  const payload=safeJson(operation.operation?.payload_json); const link=payload?.extensions?.link??{};
  const terminal=['COMPLETED','REJECTED','EXPIRED','CANCELLED'].includes(operation.operation?.state);
  const complete=terminal&&!uncertain&&(!deferred||deferredComplete)&&(!reconStart||Boolean(reconResult));
  return {evidence,plan,deferred,deferredComplete,reconStart,reconResult,finalWitness,link,complete};
}
function render(operation,witness){
  const d=derive(operation,witness),op=operation.operation??{};
  const planPayload=safeJson(d.plan?.payload_json);
  const reasons=planPayload.reasonCodes??planPayload.details?.reasonCodes??[];
  const items=[
    ['CURRENT_OPERATION_STATE',op.state??'UNKNOWN'],['CURRENT_LINK_PLAN',d.plan?.reference??'NO_PLAN_EVIDENCE'],
    ['CRITICAL_BYTES_STATUS',d.evidence.some(e=>e.kind==='CRITICAL_CORE_SENT')?'SENT_EVIDENCE_PRESENT':'NOT_PROVED'],
    ['DEFERRED_BYTES_STATUS',!d.deferred?'NONE_RECORDED':d.deferredComplete?'COMPLETE':'PENDING'],
    ['CURRENT_ASSURANCE_TIER',d.link.assuranceTier??'UNDECLARED'],
    ['LAST_TRANSPORT_ADAPTER',[...d.evidence].reverse().find(e=>e.kind==='TRANSPORT_PATH_SELECTED')?.reference??'UNDECLARED'],
    ['RECONCILIATION_STATUS',d.reconResult?'RESULT_RECORDED':d.reconStart?'REQUIRED':'NOT_RECORDED'],
    ['RECEIPT_EFFECT_STATE',op.application_outcome??'UNKNOWN'],['WITNESS_STATE',d.finalWitness],
    ['FULL_EVIDENCE_COMPLETE',d.complete?'YES':'NO']
  ];
  $('linkGrid').innerHTML=items.map(([k,v])=>`<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
  $('linkReasons').innerHTML=(Array.isArray(reasons)?reasons:String(reasons).split(',')).filter(Boolean).map(x=>`<li>${esc(x)}</li>`).join('')||'<li>No structured reason-code evidence recorded.</li>';
  $('linkEvidence').innerHTML=d.evidence.map(e=>`<li><strong>${esc(e.kind)}</strong><small>${esc(e.source)} · ${esc(e.reference)}</small><div>${esc(e.evidence_sha256)}</div></li>`).join('')||'<li>No Link evidence recorded for this operation.</li>';
  $('linkStatus').textContent=d.complete?'Evidence package complete inside recorded scope.':'Not fully complete: required evidence, reconciliation, Witness certainty, or terminal state remains unresolved.';
}
async function load(id){const encoded=encodeURIComponent(id);const [operation,witness]=await Promise.all([api(`/api/v1/operations/${encoded}`),api(`/api/v1/operations/${encoded}/witness`)]);render(operation,witness);}
$('linkForm').addEventListener('submit',(event)=>{event.preventDefault();load($('operationId').value).catch((e)=>$('linkStatus').textContent=e.message);});
const id=new URLSearchParams(location.search).get('operationId');if(id){$('operationId').value=id;load(id).catch((e)=>$('linkStatus').textContent=e.message);}
