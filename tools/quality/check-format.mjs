import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const files=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n').filter(Boolean).filter((f)=>/\.(ts|js|mjs|json|md|yml|yaml|css|html|kt|kts|sql)$/.test(f));
const bad=[];for(const file of files){const text=readFileSync(file,'utf8');if(text.includes('\r\n')||(!text.endsWith('\n')&&!file.endsWith('.json'))||/[ \t]+$/m.test(text))bad.push(file);}if(bad.length){console.error(JSON.stringify({ok:false,bad}));process.exit(1);}console.log(JSON.stringify({ok:true,files:files.length}));
