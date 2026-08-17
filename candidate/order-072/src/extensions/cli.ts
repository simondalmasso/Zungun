#!/usr/bin/env node
// PROVENANCE: RECONSTRUCTED_FROM_ORDER; extension CLI, root oracle has no CLI side effects.
import path from 'node:path';
import { generateControlRoomKit, generateWo2841Evidence, verifyControlRoomKit } from './artifacts.js';

function outArg(args: readonly string[]): string {
  const index = args.indexOf('--out');
  if (index < 0 || args[index + 1] === undefined) throw new Error('--out <directory> required');
  return path.resolve(args[index + 1]);
}

const args = process.argv.slice(2);
const command = args[0];
try {
  if (command === 'wo-2841') {
    const dir = outArg(args); const files = generateWo2841Evidence(dir);
    console.log(JSON.stringify({ ok: true, command, out: dir, files, verdict: 'EFFECT_CONFIRMED', action: 'DO_NOT_RETRY' }));
    console.error('WO-2841: lost response reconciled through the exact oracle; effect confirmed; do not retry.');
  } else if (command === 'control-room') {
    const dir = outArg(args); const files = generateControlRoomKit(dir);
    console.log(JSON.stringify({ ok: true, command, out: dir, files, routes: 7 }));
  } else if (command === 'verify-kit') {
    const target = args[1]; if (target === undefined) throw new Error('verify-kit <directory> required');
    const result = verifyControlRoomKit(path.resolve(target));
    if (args.includes('--json')) console.log(JSON.stringify(result));
    else console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.passed}/${result.total}`);
    if (!result.ok) process.exitCode = 1;
  } else {
    throw new Error('usage: zungun-demo wo-2841 --out <dir> | control-room --out <dir> | verify-kit <dir> [--json]');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
