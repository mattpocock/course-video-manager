export const EXPORT_HELP = `Export a Video, as the Export button on its Video Editor page does, and wait
for its Exported Video.

The command runs none of the export itself. It ENQUEUES the 'export' Job — the
same Job the Export button starts — and the Sidecar (started by 'pnpm dev' /
'pnpm start' on the author's machine) runs it with ffmpeg. Its progress shows
in the Upload Manager and its log is .data/logs/jobs/<jobId>.jsonl in this
checkout (printed as an absolute path). If the
Sidecar is not running, the Job waits in the queue until it is (a 'waiting'
line says so on STDERR). A failed attempt is retried, up to 3 attempts in all.
A Video whose Exported Video is already there for its current Export Hash
finishes at once, with nothing rendered again.

A Video has at most one live Export: while one is queued or running (from the
button, a Batch export or an earlier 'cvm video export'), asking again, here
or in the app, follows that Job instead of starting another.

OUTPUT
  By default it waits for the Job, reading it once a second, and prints
  { videoId, jobId, status: "succeeded", path }: the absolute path of the
  Exported Video. With --no-wait it prints { videoId, jobId, status, log } at
  once (status "queued", or "running" when it joined a running Job).

  --timeout <seconds>  how long to wait (default 3600). Running out is
  "ExportWaitTimeoutError" on STDERR, with the jobId and the log's absolute
  path. The Export goes on: run the same command again to keep waiting on
  that Job.

FAILURES
  A failure is reported only once the last of its up to 3 attempts has
  failed: a retried attempt is not a failure. It prints the Export's error
  on STDERR and exits 4 — "ExportError" with its message, or
  "ExportJobFailedError" with the jobId, the message and the tag the Job
  recorded (failedWith). "ExportInterruptedError": its Sidecar stopped
  mid-export. "ExportCancelledError": the Export was cancelled.
  A failure and a timeout both exit 4: tell them apart by _tag.
  An unknown Video id is a not-found (exit 2); --timeout under 1 is exit 3.

LOCAL-ONLY
  The export reads raw footage and writes finished-videos/ on this machine's
  disk, so on any other box it is refused before anything happens — _tag
  "LocalOnlyCommandError", exit 7, no Job. Stop rather than retry.

It does no upload and no Publish: those are separate steps.`;
