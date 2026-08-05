import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const out='.artifacts/security';mkdirSync(out,{recursive:true});
const tracked=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const components=[
 {name:'zungun-protocol-core',version:'1.0.0-order075',license:'Apache-2.0',type:'library'},
 {name:'zungun-receiver',version:'1.0.0-order075',license:'Apache-2.0',type:'application'},
 {name:'zungun-control-room',version:'1.0.0-order075',license:'Apache-2.0',type:'application'},
 {name:'typescript',version:'5.8.3',license:'Apache-2.0',type:'development-library'},
];
const sbom={bomFormat:'CycloneDX',specVersion:'1.5',serialNumber:`urn:uuid:${createHash('sha256').update(tracked.join('\n')).digest('hex').slice(0,32)}`,version:1,metadata:{component:{name:'Zungun',version:'1.0.0-order075',type:'application'}},components};
writeFileSync(`${out}/sbom.cdx.json`,JSON.stringify(sbom,null,2)+'\n');
writeFileSync(`${out}/licenses.json`,JSON.stringify({schema:'zungun.licenses.v1',components:components.map(({name,version,license})=>({name,version,license}))},null,2)+'\n');
const provenance={schema:'zungun.provenance.v1',orderId:'ZUNGUN-OWNER-ARQ-FULL-PROJECT-COMPLETION-075',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),protectedOracleReference:'13d6745217672da16985d815c427aa4c953de227',trackedFiles:tracked.length,generatedAt:'1970-01-01T00:00:00.000Z'};
writeFileSync(`${out}/provenance.json`,JSON.stringify(provenance,null,2)+'\n');
const files=tracked.filter((f)=>!/(?:\.jar|\.aar|\.png|\.jpg|\.zip)$/.test(f));const secretPatterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bsk-[A-Za-z0-9]{20,}/,/AKIA[0-9A-Z]{16}/,/ghp_[A-Za-z0-9]{30,}/];const findings=[];for(const file of files){const text=readFileSync(file,'utf8');for(const pattern of secretPatterns)if(pattern.test(text))findings.push({file,pattern:String(pattern)});}writeFileSync(`${out}/secret-scan.json`,JSON.stringify({ok:findings.length===0,files:files.length,findings},null,2)+'\n');
const manifests=tracked.filter((f)=>/(?:package-lock\.json|gradle\.libs\.versions\.toml|build\.gradle\.kts)$/.test(f)).map((file)=>({file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),size:statSync(file).size}));writeFileSync(`${out}/dependency-provenance.json`,JSON.stringify({schema:'zungun.dependency-provenance.v1',manifests},null,2)+'\n');
for(const file of ['sbom.cdx.json','licenses.json','provenance.json','secret-scan.json','dependency-provenance.json']){const bytes=readFileSync(`${out}/${file}`);writeFileSync(`${out}/${file}.sha256`,`${createHash('sha256').update(bytes).digest('hex')}  ${file}\n`);}
console.log(JSON.stringify({ok:findings.length===0,sbomComponents:components.length,licenses:components.length,trackedFiles:tracked.length,secretFindings:findings.length}));if(findings.length)process.exitCode=1;
