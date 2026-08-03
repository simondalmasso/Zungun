// PROVENANCE: RECONSTRUCTED_FROM_ORDER.
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd(); const runtimeFiles = [];
function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(?:ts|js|mjs)$/.test(e.name)) runtimeFiles.push(p); } }
walk(path.resolve(root, '../../canary/zep-core-canary/vendor/zep-core/src')); walk(path.join(root, 'src', 'extensions'));
const issues = [];
const networkPatterns = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /node:https/, /node:http/, /\bnet\.connect\b/, /\bdgram\b/];
const databasePatterns = [/\bsqlite\b/i, /\bpostgres(?:ql)?\b/i, /\bmysql\b/i, /\bmongodb\b/i, /\bd1_databases\b/i, /\bkv_namespaces\b/i];
for (const f of runtimeFiles) { const t = fs.readFileSync(f, 'utf8'); for (const p of networkPatterns) if (p.test(t)) issues.push(`NETWORK_API:${path.relative(root, f)}:${p}`); for (const p of databasePatterns) if (p.test(t)) issues.push(`DATABASE_API:${path.relative(root, f)}:${p}`); }
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); const runtimeDependencies = Object.keys(pkg.dependencies ?? {});
if (runtimeDependencies.length) issues.push(`RUNTIME_DEPENDENCIES:${runtimeDependencies.join(',')}`);
console.log(JSON.stringify({ ok: issues.length === 0, scannedRuntimeFiles: runtimeFiles.length, runtimeDependencies: runtimeDependencies.length, networkCalls: issues.filter(x => x.startsWith('NETWORK')).length, databaseCalls: issues.filter(x => x.startsWith('DATABASE')).length, issues }));
if (issues.length) process.exit(1);
