# The toolchain that cross-compiles CVM's ffmpeg.exe (see build.sh).
# Pinned: the base image by digest, and every apt package by a Debian
# snapshot date, so the same inputs give the same compiler.
FROM debian:bookworm-20251020-slim@sha256:78d2f66e0fec9e5a39fb2c72ea5e052b548df75602b5215ed01a17171529f706

RUN printf '%s\n' \
      'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20251020T000000Z bookworm main' \
      'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20251020T000000Z bookworm-security main' \
      > /etc/apt/sources.list \
 && rm -f /etc/apt/sources.list.d/* \
 && apt-get -o Acquire::Retries=5 update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl git xz-utils make pkg-config nasm patch gcc libc6-dev \
      gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64 binutils-mingw-w64-x86-64 \
      mingw-w64-x86-64-dev clang llvm \
 && rm -rf /var/lib/apt/lists/*
