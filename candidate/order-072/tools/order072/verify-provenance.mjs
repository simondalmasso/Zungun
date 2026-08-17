import fs from 'node:fs';
const ledger = JSON.parse(fs.readFileSync('PROVENANCE-LEDGER.json', 'utf8'));
const allowed = new Set(['071_SOURCE', 'REMOTE_REUSED', 'GENERATED', 'UNKNOWN']);
const invalid = ledger.files.filter((x) => !allowed.has(x.classification));
const unknown = ledger.files.filter((x) => x.classification === 'UNKNOWN');
const duplicates = ledger.files.map((x) => x.path).filter((x, i, a) => a.indexOf(x) !== i);
const out = { files: ledger.files.length, unknown: unknown.length, invalid: invalid.length, duplicatePaths: duplicates.length, ok: unknown.length === 0 && invalid.length === 0 && duplicates.length === 0 };
console.log(JSON.stringify(out));
if (!out.ok) process.exit(1);
