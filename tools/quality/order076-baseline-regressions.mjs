import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const checks = [
  {
    id: 'ANDROID_WORKER_NO_HTTP',
    file: 'android/runtime/src/main/java/com/zungun/runtime/delivery/DeliveryWorker.kt',
    detects: (text) => !text.includes('HttpReceiverTransportClient') && !text.includes('ReceiverTransportClient'),
  },
  {
    id: 'ANDROID_SAMPLE_NOT_AUTOMATED',
    file: 'android/sample/src/main/java/com/zungun/sample/MainActivity.kt',
    detects: (text) => !text.includes('autoQueue') && !text.includes('zungunEndpoint'),
  },
  {
    id: 'RECONCILER_FABRICATES_APPLICATION_ACK',
    file: 'services/receiver/src/receiver.ts',
    detects: (text) => text.includes("'RECONCILER','APPLICATION_ACK'") || text.includes("'RECONCILER', 'APPLICATION_ACK'"),
  },
  {
    id: 'COMPLETENESS_INFERS_POPULATION',
    file: 'services/receiver/src/receiver.ts',
    detects: (text) => text.includes('reportingDeviceIds') && !text.includes('scope_manifests'),
  },
  {
    id: 'SINGLE_TOKEN_GRANTS_ALL_ROLES',
    file: 'services/receiver/src/auth.ts',
    detects: (text) => text.includes("['operator','reviewer','admin']") || text.includes("['operator', 'reviewer', 'admin']"),
  },
  {
    id: 'CONTROL_ROOM_PAGE_LOCAL_TOTALS',
    file: 'apps/control-room/public/app.js',
    detects: (text) => text.includes('const observed=data.items.length') || text.includes('observed=data.items.length'),
  },
  {
    id: 'KEY_PROVIDER_PRIVATE_MUTATION',
    file: 'services/receiver/src/receiver.ts',
    detects: (text) => text.includes('as any).records') || text.includes('as any).record'),
  },
  {
    id: 'RESILIENCE_RESULT_NORMALIZATION',
    file: 'tools/resilience-lab/src/run.ts',
    detects: (text) => text.includes("observedVerdict='REJECTED'") || text.includes('expectedFailure'),
  },
  {
    id: 'SBOM_HARDCODED_COMPONENTS',
    file: 'tools/security/generate-evidence.mjs',
    detects: (text) => text.includes('const components=[') && text.includes("name:'typescript'"),
  },
];

const results = checks.map((check) => {
  try {
    const text = read(check.file);
    return { id: check.id, file: check.file, detected: Boolean(check.detects(text)) };
  } catch (error) {
    return { id: check.id, file: check.file, detected: false, error: error instanceof Error ? error.message : String(error) };
  }
});
mkdirSync('.artifacts/order076', { recursive: true });
writeFileSync('.artifacts/order076/baseline-defect-detectors.json', `${JSON.stringify({
  schema: 'zungun.order076.baseline-defect-detectors.v1',
  auditedHead: 'ba0617d51376617df77dea3d88648c6a2dc87257',
  root,
  detectorCount: results.length,
  detectedCount: results.filter((result) => result.detected).length,
  results,
}, null, 2)}\n`);
const allDetected = results.every((result) => result.detected);
console.log(JSON.stringify({ ok: allDetected, detectorCount: results.length, detected: results.filter((result) => result.detected).length }));
if (!allDetected) process.exitCode = 1;
