#!/usr/bin/env node
import { ZungunWorkerAdapter, WorkerReject, parseEnvelopeFile } from './worker.js';

function arg(name:string):string|undefined { const i=process.argv.indexOf(name); return i>=0?process.argv[i+1]:undefined; }
function required(name:string):string { const value=arg(name); if(!value)throw new WorkerReject('CLI_ARGUMENT_REQUIRED',name); return value; }
function emit(value:unknown):void { process.stdout.write(JSON.stringify(value)+'\n'); }

async function main():Promise<void>{
  const command=process.argv[2]; if(!command)throw new WorkerReject('CLI_COMMAND_REQUIRED');
  const adapter=new ZungunWorkerAdapter();const stateRoot=arg('--state-root');
  if(command==='status'){emit(adapter.status(required('--execution-job-id'),stateRoot));return;}
  if(command==='collect'){emit(adapter.collect(required('--execution-job-id'),stateRoot));return;}
  if(command==='cancel'){emit(adapter.cancel(required('--execution-job-id'),stateRoot));return;}
  if(!['prepare','execute','run'].includes(command))throw new WorkerReject('UNSUPPORTED_CLI_COMMAND',command);
  const raw=parseEnvelopeFile(required('--job'));const target=required('--target-root');
  if(command==='prepare'){emit(adapter.prepare(raw,target,stateRoot).ack);return;}
  if(command==='execute'){const step=await adapter.executeOne(raw,target,stateRoot);if(step.progress)emit(step.progress);if(step.result)emit(step.result);return;}
  await adapter.run(raw,target,stateRoot,emit);
}

main().catch((error:unknown)=>{
  if(error instanceof WorkerReject){emit({schema:'ZUNGUN_WORKER_REJECTION_V1',type:'ACK',origin:'ZUNGUN',status:'REJECTED',reason_code:error.reasonCode,message:error.message});process.exitCode=2;return;}
  emit({schema:'ZUNGUN_WORKER_REJECTION_V1',type:'ACK',origin:'ZUNGUN',status:'REJECTED',reason_code:'UNEXPECTED_WORKER_ERROR',message:error instanceof Error?error.message:String(error)});process.exitCode=3;
});
