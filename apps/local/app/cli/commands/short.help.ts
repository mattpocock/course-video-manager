/**
 * Long-form --help text for the `cvm short` verbs. Domain-teaching prose
 * consumed only by Command.withDescription.
 */
export const HELP = `Short — a Standalone Video in the Short (vertical, 1080x1920) Video Format.

A Short is posted on its own, never part of a Course. Its picture is drawn by
the vertical render: its Clips concatenated, burned-in captions from their
Transcript Words, and its Overlays above them. The rendered file is
finished-videos/<videoId>.mp4 on a Storage Root.

  cvm short render <videoId>           # render the vertical file and print its path

Find a Short's id with 'cvm video list --format short'.`;

export const RENDER_HELP = `Render a Short's vertical file into finished-videos/ and print its path.

The command runs none of the render itself. It ENQUEUES the 'render-vertical'
Job — the same Job the Shorts page starts — and the Sidecar (started by
'pnpm dev' / 'pnpm start' on the author's machine) runs it with ffmpeg. Its
progress shows in the Upload Manager and its log is at
.data/logs/jobs/<jobId>.jsonl. If the Sidecar is not running, the Job waits in
the queue until it is (a 'waiting' line says so on STDERR). A failed attempt is
retried, up to 3 attempts in all.

OUTPUT
  By default it waits for the Job and prints { videoId, path }: the absolute
  path of the finished file. With --no-wait it prints { jobId, status:
  "queued", videoId, log } at once.

FAILURES
  A failed render prints the render's own error on STDERR — its _tag (e.g.
  "RenderVerticalError") and message — and exits non-zero.
  A Landscape Video is refused (exit 3): only a Short renders vertically.
  An unknown Video id is a not-found (exit 2).

LOCAL-ONLY
  The render reads raw footage and writes finished-videos/ on this machine's
  disk, so on any other box it is refused before anything happens — _tag
  "LocalOnlyCommandError", exit 7, no Job. Stop rather than retry.

It does no upload: posting is a separate step.`;
