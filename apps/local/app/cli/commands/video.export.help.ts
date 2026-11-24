export const EXPORT_HELP = `Export a Video, as the Export button on its Video Editor page does, and wait
for its Exported Video.

The command runs none of the export itself. It ENQUEUES the 'export' Job — the
same Job the Export button starts — and the Sidecar (started by 'pnpm dev' /
'pnpm start' on the author's machine) runs it with ffmpeg. Its progress shows
in the Upload Manager and its log is at .data/logs/jobs/<jobId>.jsonl. If the
Sidecar is not running, the Job waits in the queue until it is (a 'waiting'
line says so on STDERR). A failed attempt is retried, up to 3 attempts in all.
A Video whose Exported Video is already there for its current Export Hash
finishes at once, with nothing rendered again.

If the Video already has a queued or running export Job (from the button, or
an earlier 'cvm video export'), the command follows that Job instead of
starting another.

OUTPUT
  By default it waits for the Job, reading it once a second, and prints
  { videoId, jobId, status: "succeeded", path }: the absolute path of the
  Exported Video. With --no-wait it prints { videoId, jobId, status, log } at
  once (status "queued", or "running" when it joined a running Job).

  --timeout <seconds>  how long to wait (default 3600). Running out is
  "ExportWaitTimeoutError" on STDERR, with the jobId and log, exit 4. The
  Export goes on: run the same command again to keep waiting on that Job.

FAILURES
  A failed Export prints the Export's own error on STDERR — its _tag (e.g.
  "ExportError"), the jobId and the message — and exits 4.
  An unknown Video id is a not-found (exit 2).

LOCAL-ONLY
  The export reads raw footage and writes finished-videos/ on this machine's
  disk, so on any other box it is refused before anything happens — _tag
  "LocalOnlyCommandError", exit 7, no Job. Stop rather than retry.

It does no upload and no Publish: those are separate steps.`;
