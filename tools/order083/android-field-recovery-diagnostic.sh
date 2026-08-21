#!/usr/bin/env bash
set -euo pipefail
ROOT="${CANONICAL_ROOT:?CANONICAL_ROOT required}"
cd "$ROOT"
export JAVA_HOME="${JAVA_HOME:-${JAVA_HOME_17_X64:-}}"
: "${ZUNGUN_PILOT_TOKEN:?required}"
ORIGIN="${ZUNGUN_ORIGIN:-https://zungun.simondalmasso44.workers.dev}"
OUT="${ORDER083_FIELD_RECOVERY_EVIDENCE:-$ROOT/evidence/order083/field-recovery-diagnostic}"
mkdir -p "$OUT/workmanager"
GRADLE=(android/gradle/bootstrap-gradle.sh -p android --no-daemon --stacktrace)
"${GRADLE[@]}" :app:assembleDebug :app:assembleDebugAndroidTest
adb install -r android/app/build/outputs/apk/debug/app-debug.apk >/dev/null
adb install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk >/dev/null
RUNNER='com.zungun.app.test/androidx.test.runner.AndroidJUnitRunner'
run(){ local test="$1"; adb shell am instrument -w -r -e class "com.zungun.app.Order083FieldRecoveryInstrumentedTest#$test" "$RUNNER" | tee "$OUT/$test.log"; grep -q 'OK (1 test)' "$OUT/$test.log"; }
prepare_outage_control(){ local root_output; root_output="$(adb root 2>&1 || true)"; printf '%s\n' "$root_output" > "$OUT/adb-root.txt"; grep -qi 'cannot run as root' "$OUT/adb-root.txt" && { echo ADB_ROOT_REQUIRED_FOR_APPLICATION_TRAFFIC_OUTAGE >&2; return 1; }; timeout 30s adb wait-for-device; test "$(adb shell id -u 2>/dev/null|tr -d '\r')" = 0; IPT="$(adb shell 'command -v iptables' 2>/dev/null|tr -d '\r')"; test -n "$IPT"; IP6T="$(adb shell 'command -v ip6tables' 2>/dev/null|tr -d '\r' || true)"; }
delete_rule(){ local bin="$1" chain="$2"; [[ -z "$bin" ]] && return 0; adb shell "$bin -D OUTPUT -j $chain" >/dev/null 2>&1 || true; adb shell "$bin -F $chain" >/dev/null 2>&1 || true; adb shell "$bin -X $chain" >/dev/null 2>&1 || true; }
restore_network(){ delete_rule "${IPT:-}" ZUNGUN083; delete_rule "${IP6T:-}" ZUNGUN083; }
install_block(){ local bin="$1"; [[ -z "$bin" ]] && return 0; adb shell "$bin -N ZUNGUN083" >/dev/null 2>&1 || adb shell "$bin -F ZUNGUN083" >/dev/null; adb shell "$bin -A ZUNGUN083 -p tcp --dport 443 -j REJECT" >/dev/null; adb shell "$bin -I OUTPUT 1 -j ZUNGUN083" >/dev/null; }
off(){ restore_network; install_block "$IPT"; install_block "${IP6T:-}"; run phaseTrafficProbeOffline; }
on(){ restore_network; run phaseTrafficProbeOnline; }
diagnostics(){ local op="$1" file="$2"; curl --fail --silent --show-error -H "x-zungun-order083-key: $ZUNGUN_PILOT_TOKEN" "$ORIGIN/api/v1/_order083/diagnostics/$op" | tee "$file"; }
dump_workmanager(){
  adb shell dumpsys jobscheduler com.zungun.app > "$OUT/workmanager/jobscheduler.txt" 2>&1 || true
  adb shell dumpsys package com.zungun.app > "$OUT/workmanager/package.txt" 2>&1 || true
  adb logcat -d -v threadtime | grep -E 'WorkManager|WM-|Zungun|zungun' > "$OUT/workmanager/logcat.txt" 2>&1 || true
  local db
  db="$(adb shell find /data/user/0/com.zungun.app -name androidx.work.workdb -type f 2>/dev/null | tr -d '\r' | head -n1)"
  printf '%s\n' "$db" > "$OUT/workmanager/db-path.txt"
  if [[ -n "$db" ]]; then
    adb pull "$db" "$OUT/workmanager/workdb.sqlite" >/dev/null 2>&1 || true
    adb pull "$db-wal" "$OUT/workmanager/workdb.sqlite-wal" >/dev/null 2>&1 || true
    adb pull "$db-shm" "$OUT/workmanager/workdb.sqlite-shm" >/dev/null 2>&1 || true
    sqlite3 "$OUT/workmanager/workdb.sqlite" '.schema workspec' > "$OUT/workmanager/workspec-schema.txt" 2>&1 || true
    sqlite3 -header -column "$OUT/workmanager/workdb.sqlite" 'select id,state,run_attempt_count,schedule_requested_at,initial_delay,backoff_policy,backoff_delay_duration from workspec;' > "$OUT/workmanager/workspec.txt" 2>&1 || true
    sqlite3 -header -column "$OUT/workmanager/workdb.sqlite" 'select name,work_spec_id from workname;' > "$OUT/workmanager/workname.txt" 2>&1 || true
    sqlite3 -header -column "$OUT/workmanager/workdb.sqlite" "select tag,work_spec_id from worktag where tag like 'zungun:%';" > "$OUT/workmanager/worktag.txt" 2>&1 || true
  fi
}
prepare_outage_control
trap restore_network EXIT INT TERM
run phaseTrafficProbeOnline
run phase1SetupOnline
off
run phase2QueueOffline
OP_B="$(adb shell run-as com.zungun.app cat files/order083-b-operation-id.txt | tr -d '\r\n')"
test -n "$OP_B"
adb shell am force-stop com.zungun.app
restore_network
diagnostics "$OP_B" "$OUT/b-before-recovery.json"
jq -e '.fieldOperationCount==0 and .fieldEffectCount==0' "$OUT/b-before-recovery.json" >/dev/null
on
adb shell monkey -p com.zungun.app -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 5
dump_workmanager
set +e
run phase3VerifyRecovered
rc=$?
set -e
dump_workmanager
if [[ $rc -ne 0 ]]; then
  printf 'FIELD_RECOVERY_DIAGNOSTIC=FAIL\nOPERATION_ID=%s\n' "$OP_B" > "$OUT/result.txt"
  exit "$rc"
fi
diagnostics "$OP_B" "$OUT/b-after-recovery.json"
printf 'FIELD_RECOVERY_DIAGNOSTIC=PASS\nOPERATION_ID=%s\n' "$OP_B" > "$OUT/result.txt"
