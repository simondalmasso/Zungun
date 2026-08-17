// PROVENANCE: RECONSTRUCTED_FROM_ORDER; external packed consumer validates root and ./extensions.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd(); const consumerRoot = path.join(root, '.consumer'); const consumer = path.join(consumerRoot, 'work');
fs.rmSync(consumer, { recursive: true, force: true }); fs.mkdirSync(consumer, { recursive: true });
const tgz = fs.readdirSync(root).find((name) => name.endsWith('.tgz')); if (!tgz) throw new Error('packed tarball not found');
const run = (cmd, args, cwd = consumer) => { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true' } }); if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(r.status ?? 1); } return r; };
run('npm', ['init', '-y']); run('npm', ['install', path.join(root, tgz), '--ignore-scripts', '--no-audit', '--no-fund', '--offline']);
fs.writeFileSync(path.join(consumer, 'smoke.mjs'), `
import * as root from '@zungun/zep-core';
import * as ext from '@zungun/zep-core/extensions';
if (Object.keys(root).length !== 49) throw new Error('root export count');
if ('ReferenceReceiver' in root || 'runWo2841Demo' in root) throw new Error('extension leaked into root');
const proof = ext.runWo2841Demo();
if (proof.finalVerdict !== 'EFFECT_CONFIRMED') throw new Error('extension proof');
console.log(JSON.stringify({rootExports:Object.keys(root).length,extensionExports:Object.keys(ext).length,verdict:proof.finalVerdict}));
`);
const moduleSmoke = run('node', ['smoke.mjs']);
const bin = path.join(consumer, 'node_modules', '.bin', 'zungun-demo');
run(bin, ['wo-2841', '--out', path.join(consumer, 'evidence')]); run(bin, ['control-room', '--out', path.join(consumer, 'kit')]);
const verify = run(bin, ['verify-kit', path.join(consumer, 'kit'), '--json']); const parsed = JSON.parse(verify.stdout.trim());
if (!parsed.ok || parsed.passed !== 19) throw new Error('external verifier failed');
console.log(JSON.stringify({ ok: true, installedCli: true, rootAndExtensions: JSON.parse(moduleSmoke.stdout.trim()), verifyKit: `${parsed.passed}/${parsed.total}`, network: false }));
