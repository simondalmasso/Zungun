import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const root=process.cwd();
const wrangler=path.join(root,'node_modules','.bin','wrangler');
const persist=path.join(root,'.wrangler-integration');
const varsPath=path.join(root,'.dev.vars');
const token=`pilot_${randomBytes(32).toString('hex')}`;
const port=8791;
const base=`http://127.0.0.1:${port}`;
const env={...process.env,WRANGLER_SEND_METRICS:'false',NO_D1_WARNING:'true'};
const redact=(value)=>String(value).split(token).join('[REDACTED]');

function run(args){
  const result=spawnSync(wrangler,args,{cwd:root,env,encoding:'utf8'});
  if(result.status!==0)throw new Error(`WRANGLER_FAILED:${args.join(' ')}\n${redact(result.stdout)}\n${redact(result.stderr)}`);
  return result.stdout;
}
function request(pathname,init={}){
  return fetch(`${base}${pathname}`,{...init,headers:{authorization:`Bearer ${token}`,...(init.headers??{})}});
}
async function jsonResponse(response,expected){
  const text=await response.text();if(response.status!==expected)throw new Error(`HTTP_${response.status}_EXPECTED_${expected}:${redact(text)}`);return JSON.parse(text);
}
async function waitReady(child){
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw new Error(`WRANGLER_DEV_EXITED:${child.exitCode}`);
    try{const response=await request('/v0/messages/not-ready');if(response.status===404)return;}catch{}
    await new Promise((resolve)=>setTimeout(resolve,100));
  }
  throw new Error('WRANGLER_DEV_NOT_READY');
}
async function start(){
  const output=[];
  const child=spawn(wrangler,['dev','--local','--port',String(port),'--persist-to',persist,'--config','wrangler.jsonc','--log-level','error'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',(chunk)=>output.push(String(chunk)));
  child.stderr.on('data',(chunk)=>output.push(String(chunk)));
  try{await waitReady(child);}catch(error){throw new Error(`${error instanceof Error?error.message:String(error)}\n${redact(output.join(''))}`);}
  return {child,output};
}
async function stop(runtime){
  if(runtime.child.exitCode===null)runtime.child.kill('SIGTERM');
  await Promise.race([new Promise((resolve)=>runtime.child.once('exit',resolve)),new Promise((resolve)=>setTimeout(resolve,3000))]);
  if(runtime.child.exitCode===null)runtime.child.kill('SIGKILL');
}
function parseWranglerJson(text){
  const trimmed=text.trim();
  try{return JSON.parse(trimmed);}catch{}
  const start=Math.min(...['[','{'].map((c)=>{const i=trimmed.indexOf(c);return i<0?Number.POSITIVE_INFINITY:i;}));
  if(!Number.isFinite(start))throw new Error(`D1_JSON_NOT_FOUND:${redact(trimmed)}`);
  return JSON.parse(trimmed.slice(start));
}

fs.rmSync(persist,{recursive:true,force:true});
fs.writeFileSync(varsPath,`ZUNGUN_PILOT_TOKEN=${token}\n`,{mode:0o600});
let runtime;
try{
  run(['d1','migrations','apply','DB','--local','--persist-to',persist,'--config','wrangler.jsonc']);
  run(['d1','migrations','apply','DB','--local','--persist-to',persist,'--config','wrangler.jsonc']);
  runtime=await start();
  const payload=Uint8Array.of(0,1,2,253,254,255);
  const requestNow=Date.now();
  const input={zepVersion:'0.1',messageId:'msg-d1-integration-001',conversationId:'conv-d1-integration-001',senderId:'sender-d1-integration-001',recipientIds:['recipient-d1-integration-001'],createdAtMs:requestNow-1000,expiresAtMs:requestNow+600000,priority:2,contentType:'application/octet-stream',payloadBase64:Buffer.from(payload).toString('base64'),receiptPolicy:'END_RECIPIENT_ACK',messageCommitment:'commitment-d1-integration-001'};
  const created=await jsonResponse(await request('/v0/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}),201);
  if(created.result.status!=='STORED'||JSON.stringify(created).includes(input.payloadBase64))throw new Error('CREATE_RESPONSE_INVALID');
  const duplicate=await jsonResponse(await request('/v0/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}),200);
  if(duplicate.idempotent!==true)throw new Error('CREATE_IDEMPOTENCY_INVALID');
  const stored=await jsonResponse(await request('/v0/messages/msg-d1-integration-001'),200);
  if(stored.result.status!=='STORED')throw new Error('GET_STORED_INVALID');
  const [ackA,ackB]=await Promise.all([request('/v0/messages/msg-d1-integration-001/ack',{method:'POST'}),request('/v0/messages/msg-d1-integration-001/ack',{method:'POST'})]);
  const [a,b]=await Promise.all([jsonResponse(ackA,200),jsonResponse(ackB,200)]);
  if(a.result.processingReceipt.receiptId!==b.result.processingReceipt.receiptId)throw new Error('CONCURRENT_ACK_DIVERGED');
  if(a.result.processingReceipt.messageCommitment!==input.messageCommitment)throw new Error('RECEIPT_BINDING_INVALID');
  const receipt=JSON.stringify(a.result.processingReceipt);
  await stop(runtime);runtime=undefined;
  const query=run(['d1','execute','DB','--local','--persist-to',persist,'--config','wrangler.jsonc','--command',"SELECT message_id, hex(payload_blob) AS payload_hex, status, processing_receipt_id, processing_receipt_json FROM messages WHERE message_id='msg-d1-integration-001'",'--json']);
  const parsed=parseWranglerJson(query);const result=Array.isArray(parsed)?parsed[0]:parsed;const row=result?.results?.[0];
  if(!row||row.payload_hex!=='000102FDFEFF'||row.status!=='ACKNOWLEDGED'||row.processing_receipt_json!==receipt)throw new Error(`D1_PERSISTENCE_INVALID:${redact(JSON.stringify(row))}`);
  runtime=await start();
  const recovered=await jsonResponse(await request('/v0/messages/msg-d1-integration-001'),200);
  if(recovered.result.status!=='ACKNOWLEDGED'||JSON.stringify(recovered.result.processingReceipt)!==receipt)throw new Error('RESTART_RECOVERY_INVALID');
  await stop(runtime);runtime=undefined;
  console.log(JSON.stringify({ok:true,migrationsAppliedTwice:true,create:true,query:true,ack:true,concurrentAck:true,payloadHex:'000102FDFEFF',restartRecovery:true,receiptStable:true,cloudflareWrite:0}));
} finally {
  if(runtime)await stop(runtime).catch(()=>undefined);
  fs.rmSync(varsPath,{force:true});
}
