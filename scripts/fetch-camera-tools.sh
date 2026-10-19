#!/usr/bin/env bash
set -euo pipefail

tools_dir="${1:?Usage: fetch-camera-tools.sh OUTPUT_DIRECTORY}"
mkdir -p "$tools_dir"
fetch() {
  local url="$1" file="$tools_dir/$2" checksum="$3"
  if [[ ! -f "$file" ]] || [[ "$(shasum -a 256 "$file" | cut -d ' ' -f 1)" != "$checksum" ]]; then
    curl --fail --location --retry 3 "$url" --output "$file"
  fi
  [[ "$(shasum -a 256 "$file" | cut -d ' ' -f 1)" == "$checksum" ]] || { echo "Checksum mismatch: $file" >&2; exit 1; }
}
fetch https://repo.maven.apache.org/maven2/org/robolectric/android-all/16-robolectric-13921718/android-all-16-robolectric-13921718.jar android-all.jar 8b74a0a137330658d2f33f0dc715d42734f74ba8b2d7014fc2e95aa40d3f682d
fetch https://dl.google.com/dl/android/maven2/com/android/tools/r8/9.5.26/r8-9.5.26.jar r8.jar 3502f087388ce95bbf5254555927f09385dc2636873964d0bd53f3eaf4fb49ad
