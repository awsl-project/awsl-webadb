#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
: "${CAMERA_JAVA_HOME:=${JAVA_HOME:-}}"
: "${CAMERA_ANDROID_JAR:?Set CAMERA_ANDROID_JAR to Android 16 system API stubs or android-all.jar}"
: "${CAMERA_R8_JAR:?Set CAMERA_R8_JAR to r8.jar}"
camera_java="${CAMERA_JAVA_HOME:+$CAMERA_JAVA_HOME/bin/}java"
camera_javac="${CAMERA_JAVA_HOME:+$CAMERA_JAVA_HOME/bin/}javac"
camera_jar="${CAMERA_JAVA_HOME:+$CAMERA_JAVA_HOME/bin/}jar"
build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT
mkdir -p "$build_dir/classes" "$build_dir/dex" "$project_dir/public/camera"
find "$project_dir/android/camera/src" -name '*.java' -print > "$build_dir/sources"
"$camera_javac" --release 17 -cp "$CAMERA_ANDROID_JAR" -d "$build_dir/classes" @"$build_dir/sources"
"$camera_jar" --create --file "$build_dir/classes.jar" --no-manifest --date=2020-01-01T00:00:00Z -C "$build_dir/classes" .
jdk_lib=()
if [[ -n "$CAMERA_JAVA_HOME" ]]; then jdk_lib=(--lib "$CAMERA_JAVA_HOME"); fi
"$camera_java" -cp "$CAMERA_R8_JAR" com.android.tools.r8.D8 --min-api 33 \
  --lib "$CAMERA_ANDROID_JAR" "${jdk_lib[@]}" --output "$build_dir/dex" "$build_dir/classes.jar"
"$camera_jar" --create --file "$project_dir/public/camera/webadb-camera.jar" --no-manifest --date=2020-01-01T00:00:00Z -C "$build_dir/dex" .
