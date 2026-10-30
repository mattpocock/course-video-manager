#!/bin/bash
# Runs INSIDE the build container (build.sh starts it). Builds a static
# Windows ffmpeg.exe: ffmpeg's own components all left on (so nothing CVM
# uses can be missing), plus the externals CVM needs: NVENC/CUDA headers
# (h264_nvenc, hwupload_cuda, scale_cuda via cuda-llvm) and libx264 (the
# preview fallback). D3D11 (ddagrab, scale_d3d11) and dshow come with mingw.
# Everything is niced and capped at -j4 (build.sh also pins the cores).
set -euo pipefail

: "${FFMPEG_VERSION:?}" "${FFMPEG_SHA256:?}" "${CVM_BUILD:?}" "${NVCODEC_COMMIT:?}" "${X264_COMMIT:?}"
JOBS=4
HOST=x86_64-w64-mingw32
PREFIX=/tmp/deps
SRC=/tmp/build/src
OUT=/out
mkdir -p "$SRC" "$PREFIX" "$OUT"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
N="nice -n 19"

fetch_git() { # dir url commit
  git init -q "$1"
  git -C "$1" fetch -q --depth 1 "$2" "$3"
  git -C "$1" checkout -q FETCH_HEAD
}

echo "== nv-codec-headers $NVCODEC_COMMIT"
fetch_git "$SRC/nv-codec-headers" https://github.com/FFmpeg/nv-codec-headers.git "$NVCODEC_COMMIT"
make -C "$SRC/nv-codec-headers" PREFIX="$PREFIX" install >/dev/null

echo "== x264 $X264_COMMIT"
fetch_git "$SRC/x264" https://code.videolan.org/videolan/x264.git "$X264_COMMIT"
(cd "$SRC/x264" && $N ./configure --host="$HOST" --cross-prefix="$HOST-" --prefix="$PREFIX" \
   --enable-static --disable-cli --enable-pic >/dev/null && $N make -j"$JOBS" >/dev/null && make install >/dev/null)

echo "== ffmpeg $FFMPEG_VERSION + patches"
curl -sSL -o "$SRC/ffmpeg.tar.xz" "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
echo "$FFMPEG_SHA256  $SRC/ffmpeg.tar.xz" | sha256sum -c -
tar -xJf "$SRC/ffmpeg.tar.xz" -C "$SRC"
cd "$SRC/ffmpeg-$FFMPEG_VERSION"
for p in /patches/*.patch; do
  echo "applying $(basename "$p")"
  patch -p1 --no-backup-if-mismatch < "$p"
done

$N ./configure \
  --prefix=/tmp/ffmpeg \
  --arch=x86_64 --target-os=mingw32 --cross-prefix="$HOST-" --pkg-config=pkg-config \
  --extra-version="$CVM_BUILD" \
  --enable-gpl --enable-version3 --enable-static --disable-shared \
  --disable-ffplay --disable-doc --disable-debug \
  --enable-libx264 \
  --enable-ffnvcodec --enable-nvenc --enable-cuda-llvm \
  --enable-d3d11va --enable-dxva2 \
  --extra-cflags="-I$PREFIX/include" \
  --extra-ldflags="-L$PREFIX/lib -static" \
  --extra-libs="-lpthread"
# The components CVM's args need that depend on an external or the OS:
# each must be on, or the build fails here rather than at Matt's first take.
# The last five are the Live Stream composite's (overlay_cuda, streamselect,
# the RTMP/RTMPS push and the CUVID decode of the screen recorder's packets).
REQUIRED="DDAGRAB_FILTER SCALE_D3D11_FILTER SCALE_CUDA_FILTER HWUPLOAD_CUDA_FILTER HWDOWNLOAD_FILTER H264_NVENC_ENCODER LIBX264_ENCODER MJPEG_ENCODER AAC_ENCODER DSHOW_INDEV LAVFI_INDEV TEE_MUXER FLV_MUXER MPJPEG_MUXER MATROSKA_MUXER WAV_MUXER TCP_PROTOCOL PIPE_PROTOCOL EBUR128_FILTER SILENCEDETECT_FILTER OVERLAY_CUDA_FILTER STREAMSELECT_FILTER RTMP_PROTOCOL RTMPS_PROTOCOL H264_CUVID_DECODER"
: > "$OUT/components.txt"
for c in $REQUIRED; do
  if grep -qx "CONFIG_$c=yes" ffbuild/config.mak; then echo "$c yes" >> "$OUT/components.txt"
  else echo "required component $c is off" >&2; exit 1; fi
done
$N make -j"$JOBS"
$HOST-strip -o "$OUT/ffmpeg.exe" ffmpeg.exe
cp ffbuild/config.log "$OUT/config.log" 2>/dev/null || true
sha256sum "$OUT/ffmpeg.exe"
