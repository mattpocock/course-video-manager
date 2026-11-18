/** `cvm job --help` and its verbs': see GLOSSARY.md (Job, Sidecar, Job Event). */

export const HELP = `Read and wait on Sidecar JOBS: the background work the CVM queues (an export,
a vertical render, a YouTube upload, a Publish, a transcription).

LOCAL-ONLY. Jobs are rows in the queue the author's machine's Sidecar runs
from, read through that machine's own database connection. Anywhere else
every verb is refused before it reads anything: exit 7, _tag
"LocalOnlyCommandError". Stop rather than retry.

A JOB
  Every Job has a kind (export, render-vertical, youtube, publish, …), a
  status, and usually a subject (the Video or Course it is about). Status is
  one of queued (waiting for the Sidecar; a failed attempt with attempts left
  goes back here), running, succeeded, failed, interrupted (its Sidecar
  stopped mid-run on its last attempt) or cancelled. The last four are final.
  A posting Job (youtube, youtube-shorts, buffer, ai-hero) runs ONCE: a cut-off
  run ends interrupted and is never run again on its own.

  Every line a Job logged is in .data/logs/jobs/<jobId>.jsonl (the 'log'
  field): read it for why one failed.

VERBS
  get <jobId>                 one Job, with its params and what it posted
  list [--kind] [--status] [--video] [--limit]
                              Jobs newest first
  wait [--timeout <min>] <jobId…>
                              wait until every Job settles

  The verbs that queue a Job print its id: 'cvm video post-youtube', 'cvm
  short render --no-wait', 'cvm footage transcribe --no-wait', 'cvm course
  publish' (without --wait).`;

export const GET_HELP = `Read one Job: one pretty JSON object.

OUTPUT
  { id, kind, title, status, attempt, maxAttempts, subject: { type, id } | null,
    dependsOn, error: { tag, message } | null, createdAt, startedAt,
    finishedAt, log, params, progress, posted }
  'posted' is what a posting Job recorded once it posted — for a youtube Job,
  { youtubeVideoId, url } (the Studio link) — else null. 'params' is what the
  Job was queued with. An unknown id is NotFoundError, exit 2.

EXAMPLE
  cvm job get 3f0c…`;

export const LIST_HELP = `List Jobs newest first, as NDJSON (one compact object per line; no params).

FLAGS
  --kind <kind>      only this kind (youtube, export, render-vertical, …)
  --status <status>  queued | running | succeeded | failed | interrupted | cancelled
  --video <id>       only Jobs about this Video (subject type video)
  --limit <n>        at most n Jobs (default 50)

EXAMPLES
  cvm job list --video <videoId> --kind youtube
  cvm job list --status failed --limit 5`;

export const WAIT_HELP = `Wait until every Job named settles, then print each (as 'cvm job get' does),
as NDJSON in the order given.

Polls each Job once a second. If a Job is still queued and the Sidecar is not
running, STDERR says so once ({ "event": "waiting", … }): the Job starts when
the Sidecar does ('pnpm dev' or 'pnpm start' runs it).

EXIT
  0  every Job succeeded.
  2  an id is no Job (NotFoundError), checked before any waiting.
  4  JobFailedError: at least one ended failed, interrupted or cancelled.
     'failed' names each, with the failure's own tag ('cause'), message and
     'posted': what a posting Job had already posted before it failed (a
     youtube Job's { youtubeVideoId, url }), else null. A non-null 'posted'
     means the post IS out — a youtube Job that uploaded the Video and then
     failed setting its Thumbnail — so do NOT run it again: that posts a
     duplicate ('cvm video post-youtube' refuses one without --again).
     STDOUT is empty. Read the Job's log for the whole chain. An interrupted
     posting Job may or may not have posted: check before running it again.
  4  JobWaitTimeoutError: --timeout ran out; 'pending' names the Jobs still
     queued or running. Nothing is stopped — wait again.

FLAGS
  --timeout <min>   give up after this many minutes (fractions allowed;
                    default: wait as long as it takes)

EXAMPLES
  cvm job wait 3f0c…
  cvm job wait --timeout 30 3f0c… 9a1b…`;
