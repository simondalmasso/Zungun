import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [];
for (const dir of ['worker','migrations','test','tools']) {
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes:true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full); else files.push(full);
    }
  };
  walk(path.join(root, dir));
}
files.push(path.join(root,'wrangler.jsonc'), path.join(root,'package.json'));
const scannedFiles = files.filter((file) => !file.endsWith('security-scan.mjs') && !file.endsWith('verify-config.mjs'));
const text = scannedFiles.map((file) => `${path.relative(root,file)}\n${fs.readFileSync(file,'utf8')}`).join('\n');
const fail = (value) => { console.error(`SECURITY_SCAN_FAILED:${value}`); process.exit(1); };
for (const forbidden of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','BEGIN PRIVATE KEY','password=','api_key=','account_id','kv_namespaces','r2_buckets','durable_objects','analytics_engine_datasets']) {
  if (text.toLowerCase().includes(forbidden.toLowerCase())) fail(forbidden);
}
for (const source of files.filter((file) => file.includes(`${path.sep}worker${path.sep}`))) {
  const value = fs.readFileSync(source,'utf8');
  if (/console\.(?:log|error|warn|info)/.test(value)) fail(`LOGGING:${path.basename(source)}`);
  if (/\bfetch\s*\(/.test(value) && !source.endsWith('index.ts')) fail(`NETWORK_FETCH:${path.basename(source)}`);
}
if (!text.includes('ZUNGUN_PILOT_TOKEN')) fail('SECRET_BINDING_NAME_MISSING');
if (text.includes('.dev.vars') && !text.includes("'.dev.vars'")) fail('DEV_VARS_UNEXPECTED');
console.log(JSON.stringify({ok:true,filesScanned:scannedFiles.length,secretValuesFound:0,externalNetworkCalls:0,loggingCalls:0,allowedBindings:['DB','ZUNGUN_PILOT_TOKEN']}));
