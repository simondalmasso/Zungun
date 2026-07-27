import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const sourceRoot = path.resolve(process.argv[2] ?? '/mnt/data/zungun-zep-core-v0.1.5-clean-extract');
const vendorRoot = path.resolve(cwd, 'vendor/zep-core');

function filesUnder(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
      else throw new Error(`UNSUPPORTED_ENTRY:${full}`);
    }
  };
  walk(root);
  return out;
}
function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
if (!fs.existsSync(sourceRoot)) throw new Error(`SOURCE_ROOT_MISSING:${sourceRoot}`);
const sourceFiles = filesUnder(sourceRoot);
const vendorFiles = filesUnder(vendorRoot);
const union = [...new Set([...sourceFiles, ...vendorFiles])].sort();
const mismatches = [];
for (const relative of union) {
  const source = path.join(sourceRoot, relative);
  const vendor = path.join(vendorRoot, relative);
  if (!fs.existsSync(source)) mismatches.push({ path: relative, issue: 'VENDOR_EXTRA' });
  else if (!fs.existsSync(vendor)) mismatches.push({ path: relative, issue: 'VENDOR_MISSING' });
  else {
    const sourceSha = sha(source);
    const vendorSha = sha(vendor);
    if (sourceSha !== vendorSha) mismatches.push({ path: relative, issue: 'HASH_MISMATCH', sourceSha, vendorSha });
  }
}
const summary = {
  ok: mismatches.length === 0,
  sourceRoot,
  vendorRoot: path.relative(cwd, vendorRoot),
  sourceFiles: sourceFiles.length,
  vendorFiles: vendorFiles.length,
  identicalFiles: union.length - mismatches.length,
  mismatches,
};
console.log(JSON.stringify(summary));
if (!summary.ok) process.exit(1);
