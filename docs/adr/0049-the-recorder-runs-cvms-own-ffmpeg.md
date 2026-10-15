---
status: accepted
supersedes: 0034-recording-runs-in-its-own-recorder-service (decision 6's install line)
---

# The recorder runs CVM's own ffmpeg build

Decided on 2026-10-15, after #2225 made the screen's colour match OBS's and Matt said: "the color is perfect", then "It needs to be on the GPU".

## Context

OBS writes the screen as BT.709 limited-range NV12, so VS Code's #1e1e1e is Y=42. ddagrab hands ffmpeg a D3D11 BGRA frame, and `scale_d3d11` makes it NV12 on the GPU's video processor. Stock ffmpeg 8.0.1 never tells that processor the colour spaces, and the NVIDIA driver writes BT.709 full range (#1e1e1e Y=30). #2225 fixed the values by reading every frame back and squeezing the range on the CPU. Nothing in stock ffmpeg 8.0.1 does the range on the GPU from ddagrab's frame: the CUDA, Vulkan, OpenCL and libplacebo filters cannot take a D3D11 frame without a CPU copy, and `scale_d3d12` has no range option and no D3D11 mapping (master included). Newer ffmpeg needs NVIDIA driver 610+ for NVENC.

## Decision

1. **CVM builds its own ffmpeg.exe: 8.0.1 plus a patch** (`apps/local/ffmpeg/patches`). The patch gives `scale_d3d11` `out_range` and `out_color_matrix`, which set the video processor's input (full-range RGB) and output (BT.709 studio) colour spaces. The screen chain is `scale_d3d11=format=nv12:out_range=tv:out_color_matrix=bt709`, straight into NVENC.
2. **Built on Linux, reproducibly:** `apps/local/ffmpeg/build.sh` cross-compiles in a Debian container pinned by digest and snapshot date, from the 8.0.1 tarball (sha256-checked), nv-codec-headers 13.0 and x264 at pinned commits. All of ffmpeg's own components stay on; the externals are NVENC/CUDA and libx264. The build fails if any component CVM's args need is off.
3. **Installed per machine, not committed or published:** `pnpm --filter @cvm/local ffmpeg:install` builds it (cached) and copies it to `%LOCALAPPDATA%\cvm\ffmpeg\8.0.1-cvm1\`. The service looks only there (or `FFMPEG_EXE`) and refuses anything that is not `8.0.1-cvm1`. No fallback to a stock ffmpeg: it cannot make the colour.

## Consequences

- No frame leaves the GPU between ddagrab and NVENC, as before #2225.
- A new machine, or a new patch, needs `ffmpeg:install` (a ~15 min build the first time) and a recorder service restart.
- Moving to a newer ffmpeg means re-applying the patch to it and bumping `CVM_BUILD` and `FFMPEG_BUILD` together (a test checks they agree).
