#!/usr/bin/env bash
set -euo pipefail
version=8.10.2
sha256=31c55713e40233a8303827ceb42ca48a47267a0ad4bab9177123121e71524c26
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
aapt2="${ZUNGUN_AAPT2_OVERRIDE:-${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}/build-tools/35.0.0/aapt2}"
if [ -n "${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}" ] && [ -x "$aapt2" ]; then
  exec "$home/bin/gradle" -Pandroid.aapt2FromMavenOverride="$aapt2" "$@"
fi
exec "$home/bin/gradle" "$@"
