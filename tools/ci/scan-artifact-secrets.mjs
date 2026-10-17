#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const forbiddenNames = /(^|\/)(keys?\.json|.*private.*\.(pem|key|jwk|json))$/i;
const privateMarkers = [
  /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/,
  /"d"\s*:\s*"[A-Za-z0-9_-]{20,}"/,
  /"privateKey(?:Pem|Der|Base64)?"\s*:/i,
  /"private_key"\s*:/i,
];
const credentialMarkers = [
  /authorization\s*:\s*bearer\s+[A-Za-z0-9._~+\/-]{16,}/i,
  /"token"\s*:\s*"[A-Za-z0-9._~+\/-]{16,}"/i,
  /"password"\s*:\s*"[^"\n]{8,}"/i,
];
const violations = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name); const stat = statSync(path);
    if (stat.isDirectory()) { walk(path); continue; }
    const rel = relative(root, path).replaceAll('\\', '/');
    if (forbiddenNames.test(rel)) violations.push(`${rel}:credential-bearing-filename`);
    if (stat.size > 16 * 1024 * 1024) continue;
    const text = readFileSync(path).toString('utf8');
    for (const marker of privateMarkers) if (marker.test(text)) violations.push(`${rel}:private-key-material`);
    for (const marker of credentialMarkers) if (marker.test(text)) violations.push(`${rel}:credential-material`);
  }
}
walk(root);
if (violations.length) {
  console.error(JSON.stringify({ ok:false, root, violations }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok:true, artifactPrivateKeyMaterial:0, scannedRoot:root }));
