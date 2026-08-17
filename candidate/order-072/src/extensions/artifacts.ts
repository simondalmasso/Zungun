// PROVENANCE: RECONSTRUCTED_FROM_ORDER; generated files are GENERATED_ARTIFACT.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, prettyCanonicalJson, sha256 } from './canonical.js';
import { runWo2841Demo } from './demo.js';

const PACKAGE = '@zungun/zep-core';
const VERSION = '0.1.5-recovery.071';

function resetDirectory(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
function write(dir: string, name: string, content: string): void { fs.writeFileSync(path.join(dir, name), content, 'utf8'); }
function hashFile(dir: string, name: string): string { return sha256(fs.readFileSync(path.join(dir, name))); }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }

function evidenceHtml(proofJson: string): string {
  const proof = JSON.parse(proofJson) as Record<string, unknown>;
  return `<!doctype html>\n<!-- PROVENANCE: GENERATED_ARTIFACT -->\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WO-2841 Execution Proof</title><style>body{font-family:system-ui;max-width:900px;margin:40px auto;padding:0 20px;color:#172033}code,pre{background:#f4f6f8;padding:12px;border-radius:8px}dt{font-weight:700}dd{margin:0 0 12px}</style></head><body><h1>WO-2841 Execution Proof</h1><p><strong>REFERENCE DEMO ONLY</strong></p><dl><dt>Operation</dt><dd>${escapeHtml(String(proof.operationId))}</dd><dt>Verdict</dt><dd>${escapeHtml(String(proof.finalVerdict))}</dd><dt>Action</dt><dd>${escapeHtml(String(proof.action))}</dd></dl><pre id="proof-json">${escapeHtml(proofJson)}</pre><script type="application/json" id="execution-proof">${proofJson.replaceAll('<', '\\u003c')}</script></body></html>\n`;
}

export function generateWo2841Evidence(outDir: string): readonly string[] {
  resetDirectory(outDir);
  const proofJson = prettyCanonicalJson(runWo2841Demo());
  write(outDir, 'wo-2841.execution-proof.json', proofJson);
  write(outDir, 'wo-2841.report.html', evidenceHtml(proofJson));
  const manifest = {
    schemaVersion: 'zungun.demo-manifest.v1', provenance: 'GENERATED_ARTIFACT', package: PACKAGE, version: VERSION,
    caseId: 'CASE-DEMO-2841', dataClassification: 'FICTIONAL_DEMO_ONLY',
    integrityScope: 'LOCAL_ARTIFACT_INTEGRITY_ONLY_NOT_PRODUCTION_RECEIPT_CRYPTOGRAPHY',
    files: [
      { name: 'wo-2841.execution-proof.json', sha256: hashFile(outDir, 'wo-2841.execution-proof.json') },
      { name: 'wo-2841.report.html', sha256: hashFile(outDir, 'wo-2841.report.html') },
    ],
  };
  write(outDir, 'wo-2841.manifest.json', prettyCanonicalJson(manifest));
  return Object.freeze(['wo-2841.execution-proof.json', 'wo-2841.report.html', 'wo-2841.manifest.json']);
}

const ROUTES = Object.freeze([
  '#/overview', '#/inbox', '#/operations/OP-DEMO-WO-2841-001',
  '#/operations/OP-DEMO-WO-2841-001/timeline', '#/operations/OP-DEMO-WO-2841-001/proof',
  '#/operations/OP-DEMO-WO-2841-001/decision', '#/integration',
]);

function controlRoomHtml(proofJson: string): string {
  const proof = JSON.parse(proofJson) as Record<string, unknown>;
  const routesJson = JSON.stringify(ROUTES);
  return `<!doctype html>\n<!-- PROVENANCE: GENERATED_ARTIFACT -->\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zungun Control Room — Reference Demo</title><style>:root{font-family:Inter,system-ui;color:#e8eef7;background:#0e1621}*{box-sizing:border-box}body{margin:0}header{padding:24px;border-bottom:1px solid #2b394b;background:#121d2b;position:sticky;top:0}nav{display:flex;flex-wrap:wrap;gap:8px}nav a{color:#b9d6ff;text-decoration:none;padding:7px 10px;border:1px solid #334a65;border-radius:8px}main{max-width:1100px;margin:auto;padding:28px}.panel{display:none;background:#162334;border:1px solid #2b3f55;border-radius:14px;padding:24px}.panel.active{display:block}.badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#293c52}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.card{background:#101b28;border:1px solid #2a3a4c;border-radius:10px;padding:16px}pre{white-space:pre-wrap;overflow:auto;background:#0a111a;padding:16px;border-radius:10px}</style></head><body><header><h1>Zungun Control Room</h1><p>REFERENCE_DEMO_ONLY · FICTIONAL_DEMO_ONLY</p><nav>${ROUTES.map((route) => `<a href="${route}">${route.split('/').pop() || 'overview'}</a>`).join('')}</nav></header><main><section class="panel" data-route="#/overview"><h2>Overview</h2><div class="grid"><div class="card"><strong>Open ambiguity</strong><p>1 operation</p></div><div class="card"><strong>Confirmed effect</strong><p>WO-2841</p></div><div class="card"><strong>Action</strong><p>DO_NOT_RETRY</p></div></div></section><section class="panel" data-route="#/inbox"><h2>Inbox</h2><p><span class="badge">Resolved</span> OP-DEMO-WO-2841-001 — lost response reconciled.</p></section><section class="panel" data-route="#/operations/OP-DEMO-WO-2841-001"><h2>Operation detail</h2><pre>${escapeHtml(JSON.stringify({operationId:proof.operationId,deviceState:proof.deviceState,backendState:proof.backendState,erpState:proof.erpState},null,2))}</pre></section><section class="panel" data-route="#/operations/OP-DEMO-WO-2841-001/timeline"><h2>Timeline</h2><ol>${(proof.evidence as Array<Record<string,unknown>>).map((e) => `<li><strong>${escapeHtml(String(e.kind))}</strong> — ${escapeHtml(String(e.detail))}</li>`).join('')}</ol></section><section class="panel" data-route="#/operations/OP-DEMO-WO-2841-001/proof"><h2>Execution proof</h2><pre>${escapeHtml(proofJson)}</pre></section><section class="panel" data-route="#/operations/OP-DEMO-WO-2841-001/decision"><h2>Decision</h2><p><strong>${escapeHtml(String(proof.finalVerdict))}</strong></p><p>Recommended action: <strong>${escapeHtml(String(proof.action))}</strong></p></section><section class="panel" data-route="#/integration"><h2>Integration</h2><p>Android app → durable operation runtime (future) → customer backend/reference receiver → application ACK → reconciliation/evidence.</p><p>No network, database, Android runtime or production receiver exists in this demo.</p></section></main><script type="application/json" id="execution-proof">${proofJson.replaceAll('<','\\u003c')}</script><script>const routes=${routesJson};function render(){const route=routes.includes(location.hash)?location.hash:'#/overview';document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x.dataset.route===route));document.body.dataset.activeRoute=route}addEventListener('hashchange',render);render();</script></body></html>\n`;
}

export function generateControlRoomKit(outDir: string): readonly string[] {
  resetDirectory(outDir);
  const proofJson = prettyCanonicalJson(runWo2841Demo());
  write(outDir, 'wo-2841.execution-proof.json', proofJson);
  const evidenceManifest = {
    schemaVersion: 'zungun.demo-manifest.v1', provenance: 'GENERATED_ARTIFACT', package: PACKAGE, version: VERSION,
    caseId: 'CASE-DEMO-2841', dataClassification: 'FICTIONAL_DEMO_ONLY',
    integrityScope: 'LOCAL_ARTIFACT_INTEGRITY_ONLY_NOT_PRODUCTION_RECEIPT_CRYPTOGRAPHY',
    files: [{ name: 'wo-2841.execution-proof.json', sha256: hashFile(outDir, 'wo-2841.execution-proof.json') }],
  };
  write(outDir, 'wo-2841.manifest.json', prettyCanonicalJson(evidenceManifest));
  write(outDir, 'index.html', controlRoomHtml(proofJson));
  write(outDir, 'demo-script.md', `<!-- PROVENANCE: GENERATED_ARTIFACT -->\n# Three-minute walkthrough\n\n1. Open Overview and explain the explicit UNKNOWN device state.\n2. Open Timeline and show that the backend effect occurred before the response was lost.\n3. Open Proof and confirm the application ACK is bound to the stable message commitment.\n4. Open Decision: EFFECT_CONFIRMED / DO_NOT_RETRY.\n5. Open Integration and state the limits: reference demo, no Android, network, database or production cryptography.\n`);
  write(outDir, 'README-FIRST.md', `<!-- PROVENANCE: GENERATED_ARTIFACT -->\n# Zungun demo kit\n\nOpen index.html locally. This is a deterministic fictional reference demo. Run \`zungun-demo verify-kit . --json\` to verify local artifact integrity. It is not production-ready and does not claim universal exactly-once delivery.\n`);
  const names = ['index.html','wo-2841.execution-proof.json','wo-2841.manifest.json','demo-script.md','README-FIRST.md'];
  const manifest = {
    schemaVersion: 'zungun.demo-kit-manifest.v1', provenance: 'GENERATED_ARTIFACT', package: PACKAGE, version: VERSION,
    generationMode: 'DETERMINISTIC_LOCAL_REFERENCE_DEMO', dataClassification: 'FICTIONAL_DEMO_ONLY',
    routes: ROUTES, files: names.map((name) => ({ name, sha256: hashFile(outDir, name) })),
    limitations: ['NO_ANDROID_RUNTIME','NO_NETWORK','NO_DATABASE','NO_PRODUCTION_CRYPTOGRAPHY','NO_UNIVERSAL_EXACTLY_ONCE_CLAIM'],
  };
  write(outDir, 'demo-kit.manifest.json', prettyCanonicalJson(manifest));
  return Object.freeze([...names.slice(0,4), 'demo-kit.manifest.json', 'README-FIRST.md']);
}

export interface KitVerification { readonly ok: boolean; readonly passed: number; readonly total: 19; readonly checks: readonly { name: string; ok: boolean }[]; }
export function verifyControlRoomKit(dir: string): KitVerification {
  const expected = ['README-FIRST.md','demo-kit.manifest.json','demo-script.md','index.html','wo-2841.execution-proof.json','wo-2841.manifest.json'];
  const actual = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  let manifest: any = null; let proofText = ''; let html = '';
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir,'demo-kit.manifest.json'),'utf8')); } catch { manifest = null; }
  try { proofText = fs.readFileSync(path.join(dir,'wo-2841.execution-proof.json'),'utf8'); } catch { proofText = ''; }
  try { html = fs.readFileSync(path.join(dir,'index.html'),'utf8'); } catch { html = ''; }
  const proof = (() => { try { return JSON.parse(proofText) as any; } catch { return null; } })();
  const fileMap = new Map<string,string>((manifest?.files ?? []).map((x:any)=>[x.name,x.sha256]));
  const checks = [
    ['EXACT_FILE_SET', canonicalJson(actual) === canonicalJson(expected)],
    ['MANIFEST_SCHEMA', manifest?.schemaVersion === 'zungun.demo-kit-manifest.v1'],
    ['PACKAGE_IDENTITY', manifest?.package === PACKAGE && manifest?.version === VERSION],
    ['GENERATION_MODE', manifest?.generationMode === 'DETERMINISTIC_LOCAL_REFERENCE_DEMO'],
    ['FICTIONAL_DATA', manifest?.dataClassification === 'FICTIONAL_DEMO_ONLY'],
    ['ROUTE_COUNT', Array.isArray(manifest?.routes) && manifest.routes.length === 7],
    ['ROUTES_EXACT', canonicalJson(manifest?.routes) === canonicalJson(ROUTES)],
    ['HASH_COUNT', fileMap.size === 5],
    ['HASH_INDEX', fileMap.get('index.html') === (fs.existsSync(path.join(dir,'index.html')) ? hashFile(dir,'index.html') : '')],
    ['HASH_PROOF', fileMap.get('wo-2841.execution-proof.json') === (proofText ? hashFile(dir,'wo-2841.execution-proof.json') : '')],
    ['HASH_EVIDENCE_MANIFEST', fileMap.get('wo-2841.manifest.json') === (fs.existsSync(path.join(dir,'wo-2841.manifest.json')) ? hashFile(dir,'wo-2841.manifest.json') : '')],
    ['HASH_SCRIPT', fileMap.get('demo-script.md') === (fs.existsSync(path.join(dir,'demo-script.md')) ? hashFile(dir,'demo-script.md') : '')],
    ['HASH_README', fileMap.get('README-FIRST.md') === (fs.existsSync(path.join(dir,'README-FIRST.md')) ? hashFile(dir,'README-FIRST.md') : '')],
    ['PROOF_SCHEMA', proof?.schemaVersion === 'zungun.execution-proof.v1'],
    ['VERDICT', proof?.finalVerdict === 'EFFECT_CONFIRMED'],
    ['ACTION', proof?.action === 'DO_NOT_RETRY'],
    ['EMBEDDED_PROOF', html.includes(`<script type="application/json" id="execution-proof">${proofText.replaceAll('<','\\u003c')}</script>`) ],
    ['NO_EXTERNAL_REFERENCES', !/(?:https?:|src=["']\/\/|href=["']\/\/)/i.test(html)],
    ['LIMITATIONS', Array.isArray(manifest?.limitations) && manifest.limitations.includes('NO_UNIVERSAL_EXACTLY_ONCE_CLAIM')],
  ].map(([name,ok])=>({name:String(name),ok:Boolean(ok)}));
  const passed = checks.filter((x)=>x.ok).length;
  return Object.freeze({ ok: passed === 19, passed, total: 19, checks: Object.freeze(checks) });
}
