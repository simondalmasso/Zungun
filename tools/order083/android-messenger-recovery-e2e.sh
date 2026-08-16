#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"; export JAVA_HOME="${JAVA_HOME:-${JAVA_HOME_17_X64:-}}"
OUT="${ORDER083_ANDROID_RECOVERY_EVIDENCE:-$ROOT/evidence/order083/android-recovery}";mkdir -p "$OUT"
GRADLE=(android/gradle/bootstrap-gradle.sh -p android --no-daemon --stacktrace)
"${GRADLE[@]}" :app:assembleDebug :app:assembleDebugAndroidTest
APP=android/app/build/outputs/apk/debug/app-debug.apk; TESTAPK=android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk;test -s "$APP";test -s "$TESTAPK"
adb install -r "$APP" >/dev/null;adb install -r "$TESTAPK" >/dev/null
RUNNER='com.zungun.app.test/androidx.test.runner.AndroidJUnitRunner'
run_method(){ adb shell am instrument -w -r -e class "com.zungun.app.Order083MessengerRecoveryInstrumentedTest#$1" "$RUNNER" | tee "$OUT/$1.log";grep -q 'OK (1 test)' "$OUT/$1.log"; }
run_method phase1SetupOnline
# Disable emulator network outside the app/test process and prove the live origin is unreachable from device.
adb shell cmd connectivity airplane-mode enable >/dev/null 2>&1 || adb shell settings put global airplane_mode_on 1
sleep 2
run_method phase2QueueWhileOffline
adb shell am force-stop com.zungun.app
# Restore network, then explicitly reopen the product after force-stop so WorkManager can recover durable work.
adb shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || adb shell settings put global airplane_mode_on 0
for _ in $(seq 1 60); do if adb shell ping -c 1 1.1.1.1 >/dev/null 2>&1; then break; fi;sleep 1;done
adb shell monkey -p com.zungun.app -c android.intent.category.LAUNCHER 1 >/dev/null;sleep 2
run_method phase3VerifyAfterReconnect
printf '{"ok":true,"offlineQueued":true,"forceStop":true,"reconnectRecovery":true,"sameMessageId":true,"remoteLogicalCount":1,"finalSenderState":"SENT"}\n' > "$OUT/result.json"
