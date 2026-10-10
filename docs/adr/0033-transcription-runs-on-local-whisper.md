---
status: accepted
---

# Transcription runs on Local Whisper in the Sidecar, with no hosted fallback

Every **Transcription** (a Clip's text and **Transcript Words**, a **Footage** file, a vertical Short's subtitles) went to OpenAI's `whisper-1` over the network. Measured on the author's machine (RTX 4060, 8 GB, under WSL2), a Clip took a median 2.32 s from Job start to transcript stored over 310 production Jobs. faster-whisper running `large-v3-turbo` on the GPU took 0.95 s once loaded. Its text differed from OpenAI's only in spelling choices such as `gonna`/`going to`. The measurements are in PR #1991.

## Decision

1. **Local Whisper is the only engine** (Matt's call). The `transcribe-clips`, `transcribe-footage` and `render-vertical` Jobs all go through `WhisperTranscriptionService.transcribeAudioFile`. That now calls the Sidecar's one Local Whisper worker (`apps/local/sidecar/local-whisper-engine.ts`, `local-whisper/worker.py`). The `openai` package, `OPENAI_API_KEY` and `OPENAI_BASE_URL` are gone. There is no fallback and no engine switch: if the GPU or the Python env is unavailable, the Job fails with a message naming the fix, and it is retried only as the Job's own policy allows (`CLIP_TRANSCRIPTION_POLICY`).
2. **`large-v3-turbo`, batched, compute type `float16`.** The compute type is the one setting (`CVM_WHISPER_COMPUTE_TYPE`, for `int8_float16` at about half the VRAM). The model and pipeline are constants.
3. **One resident worker, unloaded after 10 idle minutes.** The model stays in VRAM (~2.2 GB) while Clips arrive, so each costs ~0.5 s on the GPU. After 10 minutes with nothing to do, the worker stops and gives the VRAM back. The next Clip pays ~2.5 s once to load it again. Files are transcribed one at a time, in order.
4. **No setup by hand.** When the Sidecar starts it builds the pinned env (`local-whisper/requirements.lock`, hashed, installed with `pip --require-hashes` into a `python3 -m venv`) and fetches the model. Both go in `~/.cache/cvm/whisper`, outside every checkout, so worktrees, clones and verify-cvm runs share one 2 GB env and one 1.6 GB download. An env is keyed by the lock and the Python version, and is built in a temp directory and renamed into place, so a later start reuses it in under a second. The CUDA libraries come from pip wheels and are loaded by path, so neither cuDNN nor `LD_LIBRARY_PATH` has to be set up.

## Consequences

- An export and a transcription share the GPU without trouble. On a verify-cvm clone, a 94 s Video exported in 35.4 s while three 26-Clip bursts transcribed beside it. Alone, the export took 32.5–35.8 s and a burst 9.8–12.6 s; beside the export, the bursts took 9.7–13.0 s. VRAM peaked at 4.2 GB of 8 GB, and nothing failed.
- A burst is serial on the GPU: 26 Clips take ~10 s, where OpenAI ran them in parallel in ~3 s. Production peaked at 3 Clips at once.
- The first start on a new machine downloads ~2 GB of wheels and the 1.6 GB model (about 2 minutes here). Transcription Jobs wait for it, and the Sidecar logs its progress.
- The CVM now needs an NVIDIA GPU and `python3` with `venv` on the machine that runs the Sidecar.
- Footage is still cut into ~27-minute chunks at silences, which OpenAI's 25 MB upload limit used to require. This now keeps each pass inside the worker's 5-minute timeout and lets a long file resume from its cached chunks.
