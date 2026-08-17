// PROVENANCE: RECONSTRUCTED_FROM_ORDER.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {generateControlRoomKit,generateWo2841Evidence,verifyControlRoomKit} from '../dist/candidate/order-072/src/extensions/index.js';
const root=path.resolve('.generated/determinism');fs.rmSync(root,{recursive:true,force:true});
const a=path.join(root,'a'),b=path.join(root,'b'),e1=path.join(root,'e1'),e2=path.join(root,'e2');generateControlRoomKit(a);generateControlRoomKit(b);generateWo2841Evidence(e1);generateWo2841Evidence(e2);
const hash=(p)=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');const compare=(x,y)=>{const ax=fs.readdirSync(x).sort(),ay=fs.readdirSync(y).sort();if(JSON.stringify(ax)!==JSON.stringify(ay))return false;return ax.every(n=>hash(path.join(x,n))===hash(path.join(y,n)))};
const ok=compare(a,b)&&compare(e1,e2)&&JSON.stringify(verifyControlRoomKit(a))===JSON.stringify(verifyControlRoomKit(b));console.log(JSON.stringify({ok,controlRoom:compare(a,b),evidence:compare(e1,e2),verifierJson:true}));if(!ok)process.exit(1);
