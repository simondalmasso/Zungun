#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN required}"
ORIGIN="${ZUNGUN_ORIGIN:-https://zungun.simondalmasso44.workers.dev}"
OUT="${ORDER083_EVIDENCE_DIR:-$ROOT/evidence/order083/production}"
mkdir -p "$OUT"; chmod 700 "$OUT"
for secret in "$CLOUDFLARE_ACCOUNT_ID" "$CLOUDFLARE_API_TOKEN"; do printf '::add-mask::%s\n' "$secret"; done
node tools/order083/generate-manifests.mjs "$ROOT" "$ROOT/evidence/order083/local" >/tmp/order083-manifest.json
SOURCE_SHA="$(node -p "require('./evidence/order083/local/result.json').sourceBundleSha256")"
STATIC_SHA="$(node -p "require('./evidence/order083/local/result.json').staticAssetManifestSha256")"
MIGRATION_SHA="$(node -p "require('./evidence/order083/local/result.json').migrationManifestSha256")"
WRANGLER=(npx --yes wrangler@4.114.0)
"${WRANGLER[@]}" deployments status --name zungun --json > "$OUT/pre-deployment.json" || true
"${WRANGLER[@]}" d1 list --json > "$OUT/d1-before.json"
D1_ID="$(node - "$OUT/d1-before.json" <<'NODE'
const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const rows=Array.isArray(d)?d:(d.result||[]);const matches=rows.filter(x=>(x.name||x.database_name)==='zungun-order083-product-v1');if(matches.length!==1){console.error(`D1_EXACT_NAME_MATCH_COUNT=${matches.length}`);process.exit(2)}const id=matches[0].uuid||matches[0].id||'';if(!/^[0-9a-fA-F-]{32,36}$/.test(id))process.exit(3);process.stdout.write(id);
NODE
)"
[[ "$D1_ID" =~ ^[0-9a-fA-F-]{32,36}$ ]]
TMP="$(mktemp -d)"; chmod 700 "$TMP"; CFG="$ROOT/cloudflare/.wrangler.order083.runtime.jsonc"; trap 'rm -rf "$TMP" "$CFG"' EXIT
node - "$D1_ID" "$SOURCE_SHA" "$STATIC_SHA" "$MIGRATION_SHA" "$CFG" <<'NODE'
const fs=require('fs');let s=fs.readFileSync('cloudflare/wrangler.jsonc','utf8');s=s.replace('__ORDER083_D1_DATABASE_ID__',process.argv[2]).replace('__SOURCE_BUNDLE_SHA256__',process.argv[3]).replace('__STATIC_ASSET_MANIFEST_SHA256__',process.argv[4]).replace('__MIGRATION_MANIFEST_SHA256__',process.argv[5]);fs.writeFileSync(process.argv[6],s);
NODE
# Preserve the active production signing identity across code-only deployments.
# Never mint a new key during deploy: it would orphan receipts and trigger Cloudflare secret rollback protection.
"${WRANGLER[@]}" d1 execute DB --remote --config "$CFG" --command "SELECT key_id,valid_until_ms FROM receipt_keys WHERE revoked_at_ms IS NULL ORDER BY valid_from_ms DESC;" --json > "$OUT/receipt-keys-before.json"
node - "$OUT/receipt-keys-before.json" <<'NODE'
const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const rows=(Array.isArray(d)?d:[]).flatMap(x=>x.results||[]);if(!rows.some(r=>Number(r.valid_until_ms)>Date.now())){console.error('NO_UNREVOKED_UNEXPIRED_RECEIPT_KEY');process.exit(2)}
NODE
REQUIRED_D1_OBJECTS="'conversations','field_operation_apply_effect','field_operation_semantic_guard','field_operations','identities','order083_faults','proof_events','rate_limits','receipt_keys','sessions','work_orders'"
"${WRANGLER[@]}" d1 execute DB --remote --config "$CFG" --command "SELECT name,type,sql FROM sqlite_master WHERE name IN ($REQUIRED_D1_OBJECTS) ORDER BY name;" --json > "$OUT/d1-schema-before.json"
node - "$OUT/d1-schema-before.json" <<'NODE'
const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const rows=(Array.isArray(d)?d:[]).flatMap(x=>x.results||[]);const required=['conversations','field_operation_apply_effect','field_operation_semantic_guard','field_operations','identities','order083_faults','proof_events','rate_limits','receipt_keys','sessions','work_orders'];const names=[...new Set(rows.map(x=>x.name))].sort();if(names.length!==0&&JSON.stringify(names)!==JSON.stringify(required)){console.error(`D1_PRESTATE_PARTIAL_OR_UNEXPECTED:${JSON.stringify(names)}`);process.exit(2)}
NODE
"${WRANGLER[@]}" d1 execute DB --remote --config "$CFG" --file "$ROOT/cloudflare/migrations/0001_order083_product.sql" --yes > "$OUT/migrations.log"
"${WRANGLER[@]}" d1 execute DB --remote --config "$CFG" --command "SELECT name,type,sql FROM sqlite_master WHERE name IN ($REQUIRED_D1_OBJECTS) ORDER BY name;" --json > "$OUT/d1-schema-after.json"
"${WRANGLER[@]}" d1 execute DB --remote --config "$CFG" --command "PRAGMA foreign_key_check;" --json > "$OUT/d1-foreign-key-check.json"
node - "$OUT/d1-schema-after.json" "$OUT/d1-foreign-key-check.json" "$ROOT/cloudflare/migrations/0001_order083_product.sql" "$OUT/d1-migration-evidence.json" "$D1_ID" "$MIGRATION_SHA" <<'NODE'
const fs=require('fs'),crypto=require('crypto');const [schemaFile,fkFile,migrationFile,out,d1Id,manifestSha]=process.argv.slice(2);const schema=JSON.parse(fs.readFileSync(schemaFile,'utf8'));const rows=(Array.isArray(schema)?schema:[]).flatMap(x=>x.results||[]);const expected={conversations:'table',field_operation_apply_effect:'trigger',field_operation_semantic_guard:'trigger',field_operations:'table',identities:'table',order083_faults:'table',proof_events:'table',rate_limits:'table',receipt_keys:'table',sessions:'table',work_orders:'table'};const actual=Object.fromEntries(rows.map(x=>[x.name,x.type]));for(const [name,type] of Object.entries(expected))if(actual[name]!==type){console.error(`D1_OBJECT_MISSING_OR_WRONG_TYPE:${name}:${actual[name]||'missing'}`);process.exit(2)}const fk=JSON.parse(fs.readFileSync(fkFile,'utf8'));const fkRows=(Array.isArray(fk)?fk:[]).flatMap(x=>x.results||[]);if(fkRows.length!==0){console.error(`D1_FOREIGN_KEY_CHECK_FAILED:${JSON.stringify(fkRows)}`);process.exit(3)}const migrationBytes=fs.readFileSync(migrationFile);fs.writeFileSync(out,JSON.stringify({ok:true,method:'PINNED_OFFICIAL_WRANGLER_D1_EXECUTE_FILE',wranglerVersion:'4.114.0',databaseName:'zungun-order083-product-v1',databaseId:d1Id,migration:'0001_order083_product.sql',migrationFileSha256:crypto.createHash('sha256').update(migrationBytes).digest('hex'),migrationManifestSha256:manifestSha,objects:Object.keys(expected).sort(),foreignKeyCheck:'PASS'},null,2)+'\n');
NODE
(
 cd cloudflare
 npx --yes wrangler@4.114.0 deploy --config "$CFG" --x-provision=false --x-auto-create=false 2>&1 | tee "$OUT/deploy.log"
)
"${WRANGLER[@]}" deployments status --name zungun --json > "$OUT/post-deployment.json"
curl --fail --silent --show-error "$ORIGIN/health" > "$OUT/live-health.json"
curl --fail --silent --show-error "$ORIGIN/version" > "$OUT/live-version.json"
node - "$SOURCE_SHA" "$STATIC_SHA" "$MIGRATION_SHA" "$D1_ID" "$OUT" <<'NODE'
const fs=require('fs');const [source,staticSha,mig,d1,out]=process.argv.slice(2);const health=JSON.parse(fs.readFileSync(`${out}/live-health.json`,'utf8'));const version=JSON.parse(fs.readFileSync(`${out}/live-version.json`,'utf8'));if(health.ok!==true||health.order!=='ORDER-083')throw new Error('PRODUCTION_HEALTH_MISMATCH');if(version.sourceBundleSha256!==source||version.staticAssetManifestSha256!==staticSha||version.migrationManifestSha256!==mig)throw new Error('PRODUCTION_SOURCE_IDENTITY_MISMATCH');fs.writeFileSync(`${out}/result.json`,JSON.stringify({ok:true,order:'ORDER-083',sourceBundleSha256:source,staticAssetManifestSha256:staticSha,migrationManifestSha256:mig,d1DatabaseId:d1,readOnlyProductionSmoke:'PASS',liveE2E:'NOT_RUN_READ_ONLY_POLICY'},null,2)+'\n');
NODE
printf 'ORDER083_PRODUCTION_DEPLOY=PASS\nSOURCE_BUNDLE_SHA256=%s\nSTATIC_ASSET_MANIFEST_SHA256=%s\nMIGRATION_MANIFEST_SHA256=%s\nD1_ID=%s\nREAD_ONLY_PRODUCTION_SMOKE=PASS\nLIVE_WRITE_E2E=NOT_RUN\n' "$SOURCE_SHA" "$STATIC_SHA" "$MIGRATION_SHA" "$D1_ID"
