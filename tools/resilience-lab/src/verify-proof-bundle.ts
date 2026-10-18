import { readFileSync } from 'node:fs';
import { verifyIncidentProofBundle, type IncidentProofBundle } from '../../../packages/protocol-core/src/witness.js';

export function verifyProofBundleFile(path: string) {
  const parsed = JSON.parse(readFileSync(path,'utf8')) as IncidentProofBundle;
  return verifyIncidentProofBundle(parsed);
}

if (process.argv[1]?.endsWith('verify-proof-bundle.js')) {
  const path=process.argv[2];
  if (!path) { console.error('usage: verify-proof-bundle <bundle.json>'); process.exitCode=2; }
  else {
    try { const result=verifyProofBundleFile(path); console.log(JSON.stringify(result)); }
    catch (error) { console.error(JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)})); process.exitCode=1; }
  }
}
