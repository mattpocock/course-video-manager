#!/bin/bash
# Builds CVM's own ffmpeg.exe on Linux: ffmpeg 8.0.1 plus patches/, cross-
# compiled for Windows in a pinned Debian container (Dockerfile). The
# recorder needs the patch: it makes scale_d3d11 convert ddagrab's RGB to
# BT.709 limited range on the GPU (out_range=tv), which stock ffmpeg cannot.
#
#   apps/local/ffmpeg/build.sh            build into ~/.cache/cvm/ffmpeg/<version>/
#   apps/local/ffmpeg/build.sh --force    rebuild even if it is there
#
# Then install.sh copies it to Windows, where the recorder looks for it.
# Heavily niced: the container is pinned to cores 6-9 and make runs -j4 at
# nice 19, so a build never competes with a recording.
set -euo pipefail

# Keep in step with FFMPEG_VERSION in recorder-service/windows-devices.ts
# (a test checks): ffmpeg -version reports "<FFMPEG_VERSION>-<CVM_BUILD>".
FFMPEG_VERSION=8.0.1
CVM_BUILD=cvm1
FFMPEG_SHA256=05ee0b03119b45c0bdb4df654b96802e909e0a752f72e4fe3794f487229e5a41
NVCODEC_COMMIT=e844e5b26f46bb77479f063029595293aa8f812d # n13.0.19.0: NVENC SDK 13.0, driver 570+
X264_COMMIT=b35605ace3ddf7c1a5d67a2eb553f034aef41d55    # x264 stable

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HOME/.cache/cvm/ffmpeg/$FFMPEG_VERSION-$CVM_BUILD"
IMAGE=cvm-ffmpeg-build:$FFMPEG_VERSION-$CVM_BUILD

if [[ -f "$OUT/ffmpeg.exe" && "${1:-}" != "--force" ]]; then
  echo "already built: $OUT/ffmpeg.exe (--force to rebuild)"
  exit 0
fi
mkdir -p "$OUT"

nice -n 19 docker build --cpuset-cpus 6-9 -t "$IMAGE" "$HERE"
nice -n 19 docker run --rm --cpuset-cpus 6-9 --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e FFMPEG_VERSION="$FFMPEG_VERSION" -e FFMPEG_SHA256="$FFMPEG_SHA256" -e CVM_BUILD="$CVM_BUILD" \
  -e NVCODEC_COMMIT="$NVCODEC_COMMIT" -e X264_COMMIT="$X264_COMMIT" \
  -v "$HERE/patches:/patches:ro" -v "$HERE/inside.sh:/inside.sh:ro" \
  -v "$OUT:/out" \
  "$IMAGE" bash /inside.sh
echo "built: $OUT/ffmpeg.exe"
