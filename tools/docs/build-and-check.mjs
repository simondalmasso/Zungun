import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { createHash } from 'node:crypto';
const roots=['README.md','docs'];
const markdown=[];
function walk(path){if(!existsSync(path))return;const st=statSync(path);if(st.isDirectory())for(const name of readdirSync(path))walk(join(path,name));else if(path.endsWith('.md'))markdown.push(path);}
for(const root of roots)walk(root);
const broken=[];let links=0;
for(const file of markdown){const text=readFileSync(file,'utf8');for(const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){const target=match[1];if(!target||target.startsWith('#')||/^https?:\/\//.test(target)||target.startsWith('mailto:'))continue;links+=1;const clean=target.split('#')[0];if(!clean)continue;const resolved=normalize(join(dirname(file),clean));if(!existsSync(resolved))broken.push({file,target,resolved});}}
if(broken.length){console.error(JSON.stringify({ok:false,broken},null,2));process.exitCode=1;}else{
  rmSync('.artifacts/site',{recursive:true,force:true});mkdirSync('.artifacts/site',{recursive:true});cpSync('apps/public-site','.artifacts/site',{recursive:true});cpSync('docs','.artifacts/site/docs',{recursive:true});
  const manifest=markdown.sort().map((file)=>({file:relative('.',file),sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}));writeFileSync('.artifacts/site/docs-manifest.json',JSON.stringify({schema:'zungun.docs-manifest.v1',files:manifest,linksChecked:links},null,2)+'\n');
  console.log(JSON.stringify({ok:true,documents:markdown.length,linksChecked:links,site:'.artifacts/site'}));
}
