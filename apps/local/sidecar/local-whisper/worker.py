"""Local Whisper worker for the CVM Sidecar (faster-whisper on the GPU).

The Sidecar starts one of these and keeps it alive so the model stays resident
in VRAM: loading large-v3-turbo costs ~1.5 s, transcribing a 10 s Clip ~0.5 s.

    worker.py <model> <compute_type> <batched 0|1> <models_dir>
    worker.py --prefetch <model> <models_dir>

Protocol, one JSON object per line:
  stdout, once:  {"ready": true, "loadSeconds": 1.4}
              or {"fatal": "..."} and exit 1 (the model would not load)
  stdin:         {"id": "1", "audio": "/tmp/whisper-audio/abc.mp3"}
  stdout:        {"id": "1", "segments": [...], "words": [...]}
              or {"id": "1", "error": "..."}
Segments and words are `{start, end, text}` in seconds (a word's text has no
leading space; a segment's does).

`--prefetch` downloads the model into <models_dir> if it is not there yet and
prints {"path": "..."}; the Sidecar runs it once at startup so the first
Clip never waits on a 1.6 GB download.
"""

import ctypes
import glob
import json
import os
import sys
import time


def preload_pip_cuda_libs():
    # The nvidia-cublas-cu12 and nvidia-cudnn-cu12 wheels put the CUDA libs
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


def model_path(model_name, models_dir):
    """The model's directory in the cache, downloading it only if missing."""
    from faster_whisper.utils import download_model

    try:
        return download_model(model_name, cache_dir=models_dir, local_files_only=True)
    except Exception:
        return download_model(model_name, cache_dir=models_dir)


def prefetch(model_name, models_dir):
    send({"path": model_path(model_name, models_dir)})


def serve(model_name, compute_type, batched, models_dir):
    preload_pip_cuda_libs()
    from faster_whisper import BatchedInferencePipeline, WhisperModel

    started = time.perf_counter()
    try:
        model = WhisperModel(
            model_path(model_name, models_dir), device="cuda", compute_type=compute_type
        )
    except Exception as error:
        send({"fatal": f"{type(error).__name__}: {error}"})
        sys.exit(1)
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


def main():
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    if sys.argv[1] == "--prefetch":
        prefetch(sys.argv[2], sys.argv[3])
    else:
        serve(sys.argv[1], sys.argv[2], sys.argv[3] == "1", sys.argv[4])


if __name__ == "__main__":
    main()
