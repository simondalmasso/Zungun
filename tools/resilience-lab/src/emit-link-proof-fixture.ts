import { mkdirSync, writeFileSync } from 'node:fs';
import { runLinkBlackoutDrill } from './link-blackout-drill.js';
const out = '.artifacts/link'; mkdirSync(out,{recursive:true});
const proof = (await runLinkBlackoutDrill()).proofBundle;
writeFileSync(`${out}/blackout-proof-bundle.json`, `${JSON.stringify(proof,null,2)}\n`);
