#!/usr/bin/env bash
set -euo pipefail
version=8.10.2
sha256=31c55713e40233a8303827ceb42ca48a47267a0ad4bab9177123121e71524c26
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
metadata="$script_dir/verification-metadata.xml"
supplement="$script_dir/order080-verification.patch"
cache="${GRADLE_USER_HOME:-$HOME/.gradle}/zungun-distributions"
zip="$cache/gradle-$version-bin.zip"
home="$cache/gradle-$version"
mkdir -p "$cache"
if [ ! -x "$home/bin/gradle" ]; then
  if [ ! -f "$zip" ]; then curl --fail --location --silent --show-error "https://services.gradle.org/distributions/gradle-$version-bin.zip" -o "$zip"; fi
  printf '%s  %s\n' "$sha256" "$zip" | sha256sum --check --status
  rm -rf "$home" "$cache/gradle-$version.tmp"
  mkdir -p "$cache/gradle-$version.tmp"
  unzip -q "$zip" -d "$cache/gradle-$version.tmp"
  mv "$cache/gradle-$version.tmp/gradle-$version" "$home"
  rmdir "$cache/gradle-$version.tmp"
fi
backup=""
if [ -f "$supplement" ]; then
  backup="$(mktemp)"
  cp "$metadata" "$backup"
  restore_metadata() {
    cp "$backup" "$metadata"
    rm -f "$backup"
  }
  trap restore_metadata EXIT INT TERM
  (cd "$repo_root" && git apply --check "$supplement" && git apply "$supplement")
fi
sdkroot="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [ -n "${GITHUB_PATH:-}" ] && [ -n "$sdkroot" ] && [ -x "$sdkroot/platform-tools/adb" ]; then
  wrapper_dir="${RUNNER_TEMP:-$cache}/zungun-platform-tools-bin"
  mkdir -p "$wrapper_dir"
  cat > "$wrapper_dir/adb" <<EOF
#!/usr/bin/env bash
set -euo pipefail
real_adb="$sdkroot/platform-tools/adb"
if [ "\${1:-}" = "wait-for-device" ]; then
  exec timeout 180 "\$real_adb" "\$@"
fi
exec "\$real_adb" "\$@"
EOF
  chmod +x "$wrapper_dir/adb"
  printf '%s\n' "$wrapper_dir" >> "$GITHUB_PATH"
  printf '%s\n' "$sdkroot/platform-tools" >> "$GITHUB_PATH"
fi
aapt2="${ZUNGUN_AAPT2_OVERRIDE:-$sdkroot/build-tools/35.0.0/aapt2}"
args=()
if [ -n "$sdkroot" ] && [ -x "$aapt2" ]; then
  args+=("-Pandroid.aapt2FromMavenOverride=$aapt2")
fi
set +e
"$home/bin/gradle" "${args[@]}" "$@"
status=$?
set -e
exit "$status"
