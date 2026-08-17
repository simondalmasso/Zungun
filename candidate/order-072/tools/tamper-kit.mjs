// PROVENANCE: RECONSTRUCTED_FROM_ORDER.
import fs from 'node:fs'; import path from 'node:path';
import { generateControlRoomKit, verifyControlRoomKit } from '../dist/candidate/order-072/src/extensions/index.js';
const root=path.resolve('.generated/tamper');fs.rmSync(root,{recursive:true,force:true});fs.mkdirSync(root,{recursive:true});
const scenarios=[
  ['index.html','append'],['wo-2841.execution-proof.json','append'],['wo-2841.manifest.json','append'],['demo-script.md','append'],['README-FIRST.md','append'],
  ['demo-kit.manifest.json','append'],['index.html','delete'],['demo-script.md','delete'],['extra.txt','add'],['wo-2841.execution-proof.json','replace']
];
let passed=0;
for(let i=0;i<scenarios.length;i++){const dir=path.join(root,String(i));generateControlRoomKit(dir);const [file,kind]=scenarios[i];const p=path.join(dir,file);if(kind==='append')fs.appendFileSync(p,'TAMPER');else if(kind==='delete')fs.rmSync(p);else if(kind==='add')fs.writeFileSync(p,'TAMPER');else fs.writeFileSync(p,'{}\n');const result=verifyControlRoomKit(dir);if(result.ok)throw new Error(`tamper accepted ${i}`);passed++;}
console.log(JSON.stringify({ok:true,passed,total:10,failClosed:true}));
