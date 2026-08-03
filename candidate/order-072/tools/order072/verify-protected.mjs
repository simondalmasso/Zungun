import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const candidate = process.cwd();
const repo = path.resolve(candidate, '../..');
const rows = fs.readFileSync(path.join(candidate, 'PROTECTED-ORACLE-BLOBS.tsv'), 'utf8').trim().split(/\r?\n/).slice(1);
const results = rows.map((line) => {
  const [, remotePath, expected] = line.split('\t');
  const bytes = fs.readFileSync(path.join(repo, remotePath));
  const header = Buffer.from(`blob ${bytes.length}\0`);
  const actual = crypto.createHash('sha1').update(header).update(bytes).digest('hex');
  return { path: remotePath, expected, actual, match: actual === expected };
});
const out = { protectedOracleBlobs: results.length, matches: results.filter((r) => r.match).length, allMatch: results.every((r) => r.match), results };
console.log(JSON.stringify(out));
if (!out.allMatch || out.protectedOracleBlobs !== 21) process.exit(1);
