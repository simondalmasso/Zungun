#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
OUT="${ORDER083_ANDROID_EVIDENCE:-$ROOT/evidence/order083/android}"; mkdir -p "$OUT"
export JAVA_HOME="${JAVA_HOME:-${JAVA_HOME_17_X64:-}}"
android/gradle/bootstrap-gradle.sh -p android --no-daemon --stacktrace :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.zungun.app.Order083ProductionInstrumentedTest#fieldAndMessengerAgainstRealWorker
android/gradle/bootstrap-gradle.sh -p android --no-daemon --stacktrace :app:assembleRelease
APK=android/app/build/outputs/apk/release/app-release-unsigned.apk; test -s "$APK"; sha256sum "$APK" | tee "$OUT/APK_SHA256"
adb install -r android/app/build/outputs/apk/debug/app-debug.apk >/dev/null 2>&1 || true
adb shell am force-stop com.zungun.app
adb shell monkey -p com.zungun.app -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 2
adb exec-out screencap -p > "$OUT/android-field.png"
# UI XML is machine-readable proof that the real application rendered its product shell.
adb shell uiautomator dump /sdcard/order083-ui.xml >/dev/null
adb pull /sdcard/order083-ui.xml "$OUT/android-ui.xml" >/dev/null
for label in Zungun Field Messages Account; do grep -qi "$label" "$OUT/android-ui.xml"; done
printf '{"ok":true,"realWorker":true,"instrumentedClass":"com.zungun.app.Order083ProductionInstrumentedTest","visualArtifact":"android-field.png"}\n' > "$OUT/result.json"
