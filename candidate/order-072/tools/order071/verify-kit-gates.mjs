import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateControlRoomKit, verifyControlRoomKit } from '../../dist/candidate/order-072/src/extensions/index.js';

const root = process.cwd(); fs.mkdirSync('evidence/order072', { recursive: true }); const generated = path.resolve('.generated/order072');
fs.rmSync(generated, { recursive: true, force: true }); fs.mkdirSync(generated, { recursive: true });
const kit = path.join(generated, 'kit'); generateControlRoomKit(kit); const verified = verifyControlRoomKit(kit);
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) { console.error(result.stdout); console.error(result.stderr); process.exit(result.status ?? 1); }
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}
const determinism = run('node', ['tools/determinism.mjs']);
const tamper = run('node', ['tools/tamper-kit.mjs']);
let browser = { available: false, ok: true, passed: 0, total: 0, reason: 'browser unavailable' };
if (fs.existsSync('/usr/bin/chromium')) {
  const probe = spawnSync('python', ['-c', 'import playwright'], { encoding: 'utf8' });
  if (probe.status === 0) {
    generateControlRoomKit(path.join(generated, 'browser-kit'));
    browser = { available: true, ...run('python', ['tools/browser-e2e.py', path.join(generated, 'browser-kit/index.html')]) };
  }
}
const output = {
  ok: verified.ok && verified.passed === 19 && determinism.ok && tamper.ok && tamper.passed === 10 && (!browser.available || (browser.ok && browser.passed === 7)),
  kit: verified,
  determinism,
  tamper,
  browser,
};
fs.writeFileSync('evidence/order072/kit-gates.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: output.ok, kit: `${verified.passed}/${verified.total}`, determinism: determinism.ok, tamper: `${tamper.passed}/${tamper.total}`, browser: browser.available ? `${browser.passed}/${browser.total}` : 'UNAVAILABLE' }));
if (!output.ok) process.exit(1);
