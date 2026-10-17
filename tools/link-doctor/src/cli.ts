import { readFileSync } from 'node:fs';
import { analyzeOpenApi, analyzeSource } from './analyze.js';

const args = process.argv.slice(2);
const openApiIndex = args.indexOf('--openapi');
if (openApiIndex >= 0) {
  const path = args[openApiIndex + 1]; if (!path) throw new Error('OPENAPI_PATH_REQUIRED');
  const report = analyzeOpenApi(readFileSync(path, 'utf8'), path);
  const reconciliationFindings = report.scaffold.operations
    .filter((operation) => operation.retryContract === 'UNKNOWN_REQUIRES_ANNOTATION')
    .map((operation) => Object.freeze({
      ruleId: 'ZL015_NO_RECEIVER_RECONCILIATION_PATH' as const,
      severity: 'WARNING' as const,
      location: `${path}:${operation.method} ${operation.path}`,
      evidence: 'mutating operation has no declared reconcile-before-retry contract',
      explanation: 'Ambiguous side-effect outcomes require an explicit receiver reconciliation path before automatic retry can be considered safe.',
      limitations: 'OpenAPI cannot prove runtime reconciliation behavior; verify the receiver query and idempotency implementation.',
      recommendedTier: 'L1' as const,
    }));
  console.log(JSON.stringify({ ...report, findings: Object.freeze([...report.findings, ...reconciliationFindings]) }, null, 2));
} else {
  const files = args.filter((arg) => !arg.startsWith('--'));
  if (files.length === 0) throw new Error('SOURCE_PATH_REQUIRED');
  const findings = files.flatMap((path) => analyzeSource(path, readFileSync(path, 'utf8')));
  console.log(JSON.stringify({ findings }, null, 2));
}
