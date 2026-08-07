#!/usr/bin/env bash
set -euo pipefail

: "${ANDROID_SDK_ROOT:?}"
: "${RUNNER_TEMP:?}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
adb="$ANDROID_SDK_ROOT/platform-tools/adb"
emulator="$ANDROID_SDK_ROOT/emulator/emulator"
avdmanager="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/avdmanager"
out="$RUNNER_TEMP/order076-real-e2e"
state="$RUNNER_TEMP/order076-proxy"
data="$RUNNER_TEMP/order076-receiver"
export ANDROID_USER_HOME="$RUNNER_TEMP/order076-android-user-home"
export ANDROID_EMULATOR_HOME="$ANDROID_USER_HOME"
export ANDROID_AVD_HOME="$ANDROID_USER_HOME/avd"
mkdir -p "$out" "$state" "$data" "$ANDROID_AVD_HOME"

app_token='android-client-token-order076b'
reader_token='reader-principal-token-order076b'
worker_token='worker-principal-token-order076b'
reviewer_token='reviewer-principal-token-order076b'
admin_token='admin-principal-token-order076b'
receiver_id='receiver_order076b'
principals="$(jq -cn --arg app "$app_token" --arg reader "$reader_token" --arg worker "$worker_token" --arg reviewer "$reviewer_token" --arg admin "$admin_token" '[
 {subject:"android-client",token:$app,roles:["ingest","reader"]},
 {subject:"reader",token:$reader,roles:["reader"]},
 {subject:"worker",token:$worker,roles:["worker"]},
 {subject:"reviewer",token:$reviewer,roles:["reviewer"]},
 {subject:"admin",token:$admin,roles:["admin"]}
]')"

instrument() {
  local method="$1"; shift
  "$adb" shell am instrument -w -r \
    -e class "com.zungun.consumer.Order076RealReceiverInstrumentedTest#$method" \
    -e endpoint 'http://10.0.2.2:18789' \
    -e token "$app_token" \
    -e receiverId "$receiver_id" \
    "$@" \
    com.zungun.consumer.test/androidx.test.runner.AndroidJUnitRunner | tee "$out/instrument-$method.log"
  grep -F 'OK (1 test)' "$out/instrument-$method.log"
}

wait_boot() {
  timeout 180s "$adb" wait-for-device
  for _ in $(seq 1 120); do
    [ "$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && return 0
    sleep 2
  done
  return 1
}

start_receiver() {
  ZUNGUN_PRINCIPALS_JSON="$principals" \
  RECEIVER_DB="$data/receiver.sqlite" \
  RECEIVER_KEY_FILE="$data/keys.json" \
  RECEIVER_PORT=18788 RECEIVER_HOST=127.0.0.1 ZUNGUN_RECEIVER_ID="$receiver_id" \
    node dist/services/receiver/src/server.js > "$out/receiver.log" 2>&1 &
  receiver_pid=$!
  for _ in $(seq 1 90); do curl -fsS http://127.0.0.1:18788/ready >/dev/null && return 0; sleep 1; done
  cat "$out/receiver.log"; return 1
}

stop_receiver() { kill "${receiver_pid:-0}" 2>/dev/null || true; wait "${receiver_pid:-0}" 2>/dev/null || true; }
trap 'kill "${proxy_pid:-0}" 2>/dev/null || true; stop_receiver; "$adb" emu kill >/dev/null 2>&1 || true' EXIT

app_apk=android/external-consumer/build/outputs/apk/debug/external-consumer-debug.apk
test_apk=android/external-consumer/build/outputs/apk/androidTest/debug/external-consumer-debug-androidTest.apk
test -s "$app_apk" && test -s "$test_apk"

echo no | "$avdmanager" create avd --force --name zungun-order076b --package 'system-images;android-35;google_apis;x86_64' --device pixel_6
"$emulator" -list-avds | grep -Fx zungun-order076b
sudo chmod 666 /dev/kvm || true
nohup "$emulator" -avd zungun-order076b -no-window -noaudio -no-boot-anim -gpu swiftshader_indirect -accel auto > "$out/emulator.log" 2>&1 &
trap 'cat "$out/emulator.log" 2>/dev/null || true; kill "${proxy_pid:-0}" 2>/dev/null || true; stop_receiver; "$adb" emu kill >/dev/null 2>&1 || true' ERR EXIT
wait_boot
"$adb" install -r "$app_apk"
"$adb" install -r "$test_apk"

instrument configureAndEnqueueOffline
"$adb" shell am force-stop com.zungun.consumer
instrument assertProcessRecovery
"$adb" reboot
wait_boot
instrument assertRebootRecovery

start_receiver
echo drop > "$state/mode"
PROXY_PORT=18789 UPSTREAM_URL=http://127.0.0.1:18788 PROXY_STATE_DIR="$state" PROXY_MODE_FILE="$state/mode" \
  node tools/e2e/order076-fault-proxy.mjs > "$out/proxy.log" 2>&1 &
proxy_pid=$!
for _ in $(seq 1 30); do curl -sS http://127.0.0.1:18789/ready >/dev/null 2>&1 && break; sleep 1; done
instrument assertLostResponseUnknown

auth() { printf 'Authorization: Bearer %s' "$1"; }
for _ in $(seq 1 30); do [ -s "$state/drop-observed" ] && break; sleep 1; done
test -s "$state/drop-observed"
operations="$(curl -fsS -H "$(auth "$reader_token")" 'http://127.0.0.1:18788/api/v1/operations?q=WO-ANDROID-076B&limit=10&offset=0')"
test "$(jq '[.items[] | select(.work_order_id=="WO-ANDROID-076B")] | length' <<<"$operations")" = 1
operation_id="$(jq -er '.items[] | select(.work_order_id=="WO-ANDROID-076B") | .operation_id | select(type=="string" and length>0)' <<<"$operations")"

event_now_ms="$(date +%s%3N)"
curl -fsS -H "$(auth "$reviewer_token")" -H 'content-type: application/json' \
  -d "$(jq -cn --argjson now "$event_now_ms" '{note:"pre-effect evidence review",nowMs:$now}')" \
  "http://127.0.0.1:18788/api/v1/operations/$operation_id/reconcile" > "$out/pre-effect-reconcile.json"
curl -fsS -H "$(auth "$reader_token")" "http://127.0.0.1:18788/api/v1/operations/$operation_id" > "$out/pre-effect-detail.json"
test "$(jq '[.evidence[] | select(.source=="RECONCILER" and .kind=="APPLICATION_ACK")] | length' "$out/pre-effect-detail.json")" = 0

curl -fsS -H "$(auth "$admin_token")" -H 'content-type: application/json' -d "$(jq -cn --arg op "$operation_id" '{scopeType:"SHIFT",scopeId:"shift_android_076b",declarationVersion:1,expectedReportingDeviceIds:["device_android_076b"],expectedOperationIds:[$op],expectedOperationCount:1,declaredAtMs:1780000000000,provenance:"order076b-host-manifest",previousManifestHash:null}')" http://127.0.0.1:18788/api/v1/scopes/declarations > "$out/scope-positive.json"
curl -fsS -H "$(auth "$admin_token")" -H 'content-type: application/json' -d '{"scopeType":"SHIFT","scopeId":"shift_silent_076b","declarationVersion":1,"expectedReportingDeviceIds":["silent-device"],"expectedOperationIds":["missing-op"],"expectedOperationCount":1,"declaredAtMs":1780000000000,"provenance":"order076b-silent-device","previousManifestHash":null}' http://127.0.0.1:18788/api/v1/scopes/declarations > "$out/scope-negative.json"
curl -fsS -H "$(auth "$reader_token")" 'http://127.0.0.1:18788/api/v1/completeness?scopeType=SHIFT&scopeId=shift_silent_076b' > "$out/completeness-negative.json"
test "$(jq -r .completeWithinDeclaredScope "$out/completeness-negative.json")" = false

expect_status() {
  local expected="$1" token="$2" method="$3" url="$4" body="${5:-}" actual
  if [ -n "$body" ]; then
    actual="$(curl -sS -o /dev/null -w '%{http_code}' -X "$method" -H "$(auth "$token")" -H 'content-type: application/json' -d "$body" "$url")"
  else
    actual="$(curl -sS -o /dev/null -w '%{http_code}' -X "$method" -H "$(auth "$token")" "$url")"
  fi
  test "$actual" = "$expected"
}
expect_status 403 "$reader_token" POST "http://127.0.0.1:18788/api/v1/operations/$operation_id/claim" "$(jq -cn --argjson now "$(date +%s%3N)" '{ownerId:"reader",nowMs:$now,leaseMs:30000}')"
expect_status 403 "$worker_token" POST 'http://127.0.0.1:18788/api/v1/keys/rotate' "$(jq -cn --argjson now "$(date +%s%3N)" '{nowMs:$now,validityMs:86400000}')"
expect_status 403 "$reviewer_token" POST 'http://127.0.0.1:18788/api/v1/scopes/declarations' '{}'
expect_status 403 "$admin_token" POST 'http://127.0.0.1:18788/api/v1/operations' '{}'
expect_status 401 'invalid-token-order076b' GET 'http://127.0.0.1:18788/api/v1/operations'

claim1_now="$(date +%s%3N)"
claim1="$(curl -fsS -H "$(auth "$worker_token")" -H 'content-type: application/json' -d "$(jq -cn --argjson now "$claim1_now" '{ownerId:"worker-order076b",nowMs:$now,leaseMs:30000}')" "http://127.0.0.1:18788/api/v1/operations/$operation_id/claim")"
claim2_now="$((claim1_now + 1))"
claim2="$(curl -fsS -H "$(auth "$worker_token")" -H 'content-type: application/json' -d "$(jq -cn --argjson now "$claim2_now" '{ownerId:"worker-order076b",nowMs:$now,leaseMs:30000}')" "http://127.0.0.1:18788/api/v1/operations/$operation_id/claim")"
stale_effect_now="$((claim2_now + 1))"
stale_status="$(curl -sS -o "$out/stale-fencing.json" -w '%{http_code}' -H "$(auth "$worker_token")" -H 'content-type: application/json' -d "$(jq -cn --arg attempt "$(jq -r .attemptId <<<"$claim1")" --argjson fence "$(jq -r .fencingToken <<<"$claim1")" --argjson now "$stale_effect_now" '{attemptId:$attempt,fencingToken:$fence,effect:{outcome:"EFFECT_APPLIED",applicationReference:"erp:stale",applicationAcknowledged:true,workOrderStatus:"CLOSED",result:{ok:true},occurredAtMs:$now}}')" "http://127.0.0.1:18788/api/v1/operations/$operation_id/effect")"
test "$stale_status" = 409
effect_now="$((stale_effect_now + 1))"
curl -fsS -H "$(auth "$worker_token")" -H 'content-type: application/json' -d "$(jq -cn --arg attempt "$(jq -r .attemptId <<<"$claim2")" --argjson fence "$(jq -r .fencingToken <<<"$claim2")" --argjson now "$effect_now" '{attemptId:$attempt,fencingToken:$fence,effect:{outcome:"EFFECT_APPLIED",applicationReference:"erp:order076b:closed",applicationAcknowledged:true,workOrderStatus:"CLOSED",result:{closed:true},occurredAtMs:$now}}')" "http://127.0.0.1:18788/api/v1/operations/$operation_id/effect" > "$out/effect.json"
test "$(jq -r .state "$out/effect.json")" = COMPLETED
test "$(jq -r '.receipt.payload.operationId' "$out/effect.json")" = "$operation_id"

stop_receiver
start_receiver
curl -fsS -H "$(auth "$reader_token")" "http://127.0.0.1:18788/api/v1/operations/$operation_id" > "$out/post-restart-detail.json"
test "$(jq -r .operation.state "$out/post-restart-detail.json")" = COMPLETED
test "$(jq -r .receipt.payload.operationId "$out/post-restart-detail.json")" = "$operation_id"

echo pass > "$state/mode"
instrument awaitTerminalReceipt
for _ in $(seq 1 60); do [ -s "$state/final-response.json" ] && break; sleep 1; done
test -s "$state/final-response.json"
instrument verifyNegativeReceiptMatrix

keys_before="$(curl -fsS -H "$(auth "$reader_token")" http://127.0.0.1:18788/api/v1/keys)"
old_key="$(jq -r '.items[] | select(.revokedAtMs==null) | .keyId' <<<"$keys_before" | head -1)"
key_rotate_now="$(date +%s%3N)"
curl -fsS -H "$(auth "$admin_token")" -H 'content-type: application/json' -d "$(jq -cn --argjson now "$key_rotate_now" '{nowMs:$now,validityMs:86400000}')" http://127.0.0.1:18788/api/v1/keys/rotate > "$out/key-rotate.json"
curl -fsS -H "$(auth "$admin_token")" -H 'content-type: application/json' -d "$(jq -cn --argjson now "$((key_rotate_now + 1))" '{nowMs:$now}')" "http://127.0.0.1:18788/api/v1/keys/$old_key/revoke" > "$out/key-revoke.json"
stop_receiver
start_receiver
curl -fsS -H "$(auth "$reader_token")" http://127.0.0.1:18788/api/v1/keys > "$out/keys-after-restart.json"
test "$(jq --arg key "$old_key" '[.items[] | select(.keyId==$key and .revokedAtMs!=null)] | length' "$out/keys-after-restart.json")" = 1

for index in $(seq 1 30); do
  now=$((1780000100000 + index))
  curl -fsS -H "$(auth "$app_token")" -H 'content-type: application/json' -d "$(jq -cn --arg id "op_page_076b_$index" --arg nonce "nonce_page_076b_$index" --arg msg "msg_page_076b_$index" --argjson now "$now" '{protocol:"zungun.operation.v1",wireVersion:1,operationId:$id,idempotencyKey:("idem_"+$id),tenantId:"tenant_order076b",scopeType:"SHIFT",scopeId:"shift_pages_076b",workOrderId:("WO-PAGE-"+$id),messageId:$msg,messageCommitment:("sha256:"+$id),payloadBase64:"e30=",contentType:"application/json",policy:{priority:1,createdAtMs:$now,expiresAtMs:1900000000000,retryBudget:2,cancellationAllowed:false,semanticRevalidationRequired:false,maxPayloadBytes:16384},replayNonce:$nonce,extensions:{deviceId:"page-device",clientVersion:"host-order076b"}}')" http://127.0.0.1:18788/api/v1/operations >/dev/null
done

ORDER076_BASE_URL=http://127.0.0.1:18788 ORDER076_OPERATION_ID="$operation_id" ORDER076_SCOPE_ID=shift_android_076b \
ZUNGUN_READER_TOKEN="$reader_token" ZUNGUN_REVIEWER_TOKEN="$reviewer_token" ZUNGUN_ADMIN_TOKEN="$admin_token" \
python tools/browser/order076-same-operation-e2e.py | tee "$out/control-room.json"

curl -fsS -H "$(auth "$reader_token")" 'http://127.0.0.1:18788/api/v1/completeness?scopeType=SHIFT&scopeId=shift_android_076b' > "$out/completeness-positive.json"
test "$(jq -r .completeWithinDeclaredScope "$out/completeness-positive.json")" = true
stop_receiver
cp "$data/receiver.sqlite" "$out/receiver.sqlite"
cp "$data/keys.json" "$out/keys.json"
cp "$state/drop-observed" "$out/drop-observed"
printf '%s\n' "$operation_id" > "$out/operation-id.txt"
printf '%s\n' "$receiver_id" > "$out/receiver-id.txt"
(cd "$out" && find . -type f ! -name MANIFEST.sha256 -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > MANIFEST.sha256)