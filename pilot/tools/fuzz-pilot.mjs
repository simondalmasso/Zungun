import { PilotService } from '../dist/pilot/worker/service.js';
import { cloneStored, sameImmutableMessage } from '../dist/pilot/worker/model.js';

const TOKEN='pilot-fuzz-token-0123456789abcdef0123456789abcdef';
const NOW=1_800_000_000_000;
class Repo { constructor(){this.rows=new Map();this.key=Uint8Array.from({length:32},(_,i)=>i);} async createOrGet(c){const e=this.rows.get(c.messageId);if(e){if(!sameImmutableMessage(e,c))throw new Error('DUPLICATE_CONFLICT');return{record:cloneStored(e),created:false};}this.rows.set(c.messageId,cloneStored(c));return{record:cloneStored(c),created:true};} async get(id){const r=this.rows.get(id);return r?cloneStored(r):null;} async getOrCreateReceiptSigningKey(){return this.key.slice();} async acknowledge(id,c,at,rid,rjson){const r=this.rows.get(id);if(!r)return null;if(r.status!=='STORED'||r.messageCommitment!==c||r.expiresAtMs<=at)return{record:cloneStored(r),transitioned:false};const n=cloneStored({...r,status:'ACKNOWLEDGED',acknowledgedAtMs:at,processingReceiptId:rid,processingReceiptJson:rjson});this.rows.set(id,n);return{record:cloneStored(n),transitioned:true};}}
function base(i){return{zepVersion:'0.1',messageId:`m-${i}`,conversationId:'c',senderId:'s',recipientIds:['r'],createdAtMs:NOW-1,expiresAtMs:NOW+1000,priority:1,contentType:'application/octet-stream',payloadBase64:'AA==',receiptPolicy:'END_RECIPIENT_ACK',messageCommitment:`k-${i}`};}
let nativeErrors=0, reflections=0, pollution=0;const statuses={};
for(let i=0;i<2048;i++){
  const repo=new Repo();const svc=new PilotService(repo,TOKEN,{now:()=>NOW});let body;
  switch(i%8){case 0:body=base(i);break;case 1:body={...base(i),unknown:'x'};break;case 2:body={...base(i),payloadBase64:'%%%'};break;case 3:body={...base(i),expiresAtMs:NOW};break;case 4:body=null;break;case 5:body=[];break;case 6:body={...base(i),recipientIds:[]};break;default:body={...base(i),priority:true};}
  try{
    const secret=`secret-${i}`;const req=new Request('https://pilot.invalid/v0/messages',{method:'POST',headers:{authorization:`Bearer ${TOKEN}`,'content-type':'application/json'},body:JSON.stringify(body).replace(/}$/,i%17===0?',"__proto__":{"polluted":true}}':'}')});
    const res=await svc.handle(req);statuses[res.status]=(statuses[res.status]??0)+1;const text=await res.text();if(text.includes(TOKEN)||text.includes(secret))reflections++;
  }catch{nativeErrors++;}
  if({}.polluted!==undefined)pollution++;
}
if(nativeErrors||reflections||pollution)process.exitCode=1;
console.log(`ZUNGUN_PILOT_FUZZ_CASES=2048 RAW_NATIVE_ERRORS=${nativeErrors} REFLECTIONS=${reflections} PROTOTYPE_POLLUTION=${pollution} STATUS_COUNTS=${JSON.stringify(statuses)}`);
