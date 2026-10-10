"""Local Whisper worker for the CVM Sidecar (faster-whisper on the GPU).

The Sidecar starts one of these and keeps it alive so the model stays resident
in VRAM: loading large-v3-turbo costs ~1.5 s, transcribing a 10 s Clip ~0.5 s.

Protocol, one JSON object per line:
  stdout, once:  {"ready": true, "loadSeconds": 1.4}
  stdin:         {"id": "1", "audio": "/tmp/whisper-audio/abc.mp3"}
  stdout:        {"id": "1", "segments": [...], "words": [...]}
              or {"id": "1", "error": "..."}
Segments and words are `{start, end, text}` in seconds, the shape OpenAI's
`verbose_json` gives (a word's text has no leading space; a segment's does).

Config (argv): <model> <compute_type> <batched 0|1> [download_root]
"""

import ctypes
import glob
import json
import os
import sys
import time


def preload_pip_cuda_libs():
    # `pip install nvidia-cublas-cu12 nvidia-cudnn-cu12` puts the CUDA libs
    # CTranslate2 needs inside site-packages, where the loader never looks.
    # Load them by path first so no LD_LIBRARY_PATH is needed.
    try:
        import nvidia  # noqa: F401
    except ImportError:
        return
    for root in nvidia.__path__:
        for pattern in ("cublas/lib/libcublas*.so.*", "cudnn/lib/libcudnn*.so.*"):
            for lib in sorted(glob.glob(os.path.join(root, pattern))):
                try:
                    ctypes.CDLL(lib, mode=ctypes.RTLD_GLOBAL)
                except OSError:
                    pass


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def main():
    model_name, compute_type, batched = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
    download_root = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None

    preload_pip_cuda_libs()
    from faster_whisper import BatchedInferencePipeline, WhisperModel

    started = time.perf_counter()
    model = WhisperModel(
        model_name, device="cuda", compute_type=compute_type, download_root=download_root
    )
    pipeline = BatchedInferencePipeline(model=model) if batched else model
    send({"ready": True, "loadSeconds": round(time.perf_counter() - started, 3)})

    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        try:
            options = {"word_timestamps": True, "language": "en"}
            if batched:
                options["batch_size"] = 8
            segments, _ = pipeline.transcribe(request["audio"], **options)
            segments = list(segments)
            send(
                {
                    "id": request["id"],
                    "segments": [
                        {"start": s.start, "end": s.end, "text": s.text} for s in segments
                    ],
                    "words": [
                        {"start": w.start, "end": w.end, "text": w.word.strip()}
                        for s in segments
                        for w in (s.words or [])
                    ],
                }
            )
        except Exception as error:  # one bad file must not kill the worker
            send({"id": request["id"], "error": f"{type(error).__name__}: {error}"})


if __name__ == "__main__":
    main()
