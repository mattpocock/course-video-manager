---
status: accepted
---

# Shorts are posted from CVM's own Posting Queue

Decided on 2026-11-03 (spec #2612, Matt's decisions of that day; replaces spec #2564).

## Context

Matt wants to "live stream for an hour and end up with content for a week". A Short went out only from the Shorts page modal, one at a time and at once: YouTube through the direct upload (the `youtube-shorts` Job kind) and TikTok through Buffer with `shareNow` (the `buffer` Job kind). Spec #2564 tried to meter Shorts through Buffer's own queue, but Buffer's free plan holds only 10 scheduled posts per channel, and the uploaded file sits under an S3 prefix (`cvm/buffer-posts/`) that a lifecycle rule deletes after 1 day. TikTok's own Content Posting API cannot replace Buffer: an unaudited client posts privately only, and its audit rejects a tool that posts to accounts "you or your team manages".

## Decision

1. **CVM owns the queue.** A Short is added to the **Posting Queue** (`cvm short post`, later the Shorts page), one entry per time it is queued, in a table of its own. At each **Posting Slot** the Sidecar of the author's main checkout posts the oldest Queued Short.
2. **Buffer is TikTok's pipe only.** At the slot the Short's file is uploaded to S3 just in time and Buffer is told to "share now", so Buffer never holds more than one post (its free plan suffices) and Buffer fetches the file within minutes, well inside the 1-day lifecycle rule.
3. **YouTube goes direct at the same slot**, public, through the existing upload. No `publishAt`.
4. **A Short is Posted only when both channels have it.** Each channel's post is still a Video Post.
5. **The Slot Schedule is one pure function** in core, given `now`, the entries and the slot patterns, reading no clock and no database:
   - the day's count comes from the queue length at 00:00 UK time (Europe/London), worked out from the entries' `queued_at` and `ended_at`, so nothing is stored per day and a day CVM was off still has a known length;
   - an empty queue at 00:00 gives the day no slot (#2612, as written: "an empty queue gives 0"); otherwise a weekday gets 1, 2 when more than 14 are queued, 3 when more than 21; Saturday and Sunday always 1. So a Short queued onto an empty queue goes out the next day;
   - a slot posts the oldest Short in the queue AT the slot: a Short queued after a slot never takes it, even when the slot is still open;
   - slot times live in one constant: 1/day 13:00; 2/day 09:00 and 18:00; 3/day 09:00, 13:00 and 18:00, as UK wall-clock times turned into instants across the clock changes (none falls in the 01:00–02:00 hour the clocks skip or repeat);
   - catch-up: a weekday after a day that had a Short to post (one was in the queue at its first slot) and claimed no slot takes the next pattern up, one extra Short at most, and 3 stays 3. Monday looks back over Friday, Saturday and Sunday; the weekend never catches up;
   - a slot missed earlier in the day is claimed at the next check, one claim per check and only once the previous claim has settled; a slot not claimed by the end of its UK day is dropped.
     The same function answers "what is due now?" for the Sidecar and "when does each Queued Short go out?" for `cvm short queue`, `cvm short post --dry-run` and the Shorts page, so they cannot disagree.
6. **Order is oldest first**, by a Fractional Index that moving a Short changes.
7. **`cvm short post` checks every Short before it queues any**: a Landscape Video, a default title, no description, a live entry and a Short already Posted on both channels are each refused (exit 3), and one refusal queues none of the batch. A Short Posted on one channel only is queued, and its slot posts only the other: a channel that went out is never posted again. It is local-only, because only this machine's Sidecar posts.

8. **The Posting Queue tick posts it** (#2614). It is a Sidecar loop of its own, every `POSTING_QUEUE_TICK_MS` (2 minutes), reading the time from Effect's `Clock`. It runs only in the author's MAIN CHECKOUT, detected as the live desk detects it (`isMainCheckout`): a worktree's or a verify-cvm clone's Sidecar never posts. Each tick:
   - marks Posted every Posting or Held entry whose Short has a posted `youtube-shorts` AND a posted `buffer` Video Post ("Posted" is derived, never set by a Job). A channel counts as Posted by any posted Video Post, ever, so nothing compares the app's clock with the database's;
   - asks the Slot Schedule what is due, and claims it in ONE transaction, under a lock every claim takes, asking the Slot Schedule again inside it: the entry becomes Posting with its slot, and one `youtube-shorts` and one `buffer` Job are enqueued (only for the channels the Short is not Posted on yet), each carrying the entry id. A crash before the commit did nothing; after it, the slot is claimed and the Jobs exist, so no tick claims it again, and the Slot Schedule claims nothing while an entry is Posting.
   - The claim reads the Short's title and description from the Video and puts them on each posting Job (TikTok's caption is the title), so an edit after queueing is what goes out, and an edit after the claim is not. The post check looks for that claimed title too, so a rename between a failed post and its retry cannot hide an upload that went out. A retry copies the failed Job's words. They stay posting kinds: one attempt, never re-run on their own.
   - A Short whose vertical export is stale is rendered just in time (#2615): stale means no export, no Short Export Hash file beside it (`{videoId}.mp4.export-hash`, written by the render), or a different hash. The claim's transaction then also enqueues a `render-vertical` Job, and both posting Jobs wait on it (`dependsOn`), so a render that fails for good posts nothing; it counts as a failure on each channel waiting on it (9).

9. **A failed channel is tried again as a NEW Job, after a post check** (#2618). Each tick, before it claims, looks at every Posting or Held entry's channels whose latest posting Job ended failed, interrupted or cancelled (a Cancel is one more failure, so the entry leaves Posting and the queue goes on) and that have no posted Video Post (`apps/local/sidecar/posting-queue-failures.ts`). It runs that kind's existing read-only post check (`checkPosted`), once per run: the answer is written as the run's `post-check` Job Event, which the post-check sweep and the author's Retry also read. A Job whose render failed, or that was cancelled before it started, needs no check: it never ran. Then, in ONE transaction under the claim's lock (`settleChannelFailures`):
   - **posted**: the channel's Video Post is recorded as posted, and nothing is posted again;
   - **unknown**: the entry is **Held**, nothing is retried, and its reason is what the check found, with its link. Matt clears it with the Job's own Retry (which refuses a run that went out) or with `cvm short unqueue`. A Held entry has settled its slot, so the next Short may claim the next one; it is marked Posted when its last channel goes out;
   - **not-posted**: one more failure on that channel (a failed render counts once for each channel waiting on it). The third marks the entry **Failed** with the reason; its slot stays used. Otherwise a new posting Job for that channel only is enqueued, after a new `render-vertical` if the export is stale.
     The transaction re-reads the channel's latest Job and its Video Posts, so a Job is never re-run, a run is acted on once, and a channel that went out is never enqueued again. A posting Job also refuses to post (`assertStillToPost`) once its entry has left the queue (taken off, Failed, Posted) or its channel went out, so a stale Job that Matt retries never posts a Short he took off, or a channel twice.
   - A Buffer run that knows nothing reached Buffer (its S3 upload failed, or Buffer answered with a refusal: a 4xx, a GraphQL or `MutationError`) removes its unposted Video Post, so the check says not-posted and it is retried. No answer or a 5xx keeps the row, and the check says unknown: Held. ADR 0058 records why.
   - This amends ADR 0032 decision 5: the Posting Queue is the one automatic route to a second post ATTEMPT. It never re-runs a Job, and only follows a check that found the post did not go out.

## Amendment 2026-11-04: Post Now (#2692)

Matt reversed the "no post now" call: "Can you post junior engineers now?" `cvm short post --now <videoId…>` marks a Short **Post Now**: one already Queued is marked, one not in the queue is checked and queued as usual and marked too; a Posting or Held Short is refused (it has its slot).

- **The decision stays in the pure Slot Schedule.** An entry carries `postNowAt`. `dueNow` claims the earliest-asked Post Now entry, at `now`, before any due slot, and still only once the previous claim settled: one post per check. `projectPostingQueue` puts Post Now entries first, at `now`, and walks the days without them, so `cvm short queue`, `--dry-run` and the Queue panel show what the tick will do, and every other Short moves up by exactly one place.
- **It claims no Posting Slot.** Its `claimedSlot` is the tick's instant. A day's claims now count only claims of that day's Posting Slot instants, so a Post Now is one extra post: it takes no slot from the Short due at it, and a day whose slot then went unclaimed is still missed and still brings catch-up.
- **No migration.** The request is stored on `claimed_at` of a QUEUED entry (`toScheduleEntry` reads it as `postNowAt`). Before this, only Posting and Held entries had a `claimedAt`, and every reader of it filters to those states, so an older Sidecar ignores the mark and posts the Short at its normal slot. The claim overwrites `claimedAt`, as it always has. The rest of the post path (just-in-time render, YouTube direct, Buffer "share now", retries, Held, Failed) is unchanged.

## Considered

- **Buffer's own queue (spec #2564).** Rejected: 10 scheduled posts per channel on the free plan, and a file uploaded days ahead is deleted by the 1-day lifecycle rule before Buffer fetches it.
- **TikTok's Content Posting API.** Rejected: private posts only without an audit that rejects own-account tools.
- **YouTube `publishAt`.** Rejected: CVM posts both channels at the same slot, and "Posted" means live everywhere.
- **Storing each day's slot count.** Rejected: it is derivable from the entries' history, which also covers a day CVM was off.

## Consequences

- An entry is never deleted while it can matter to the schedule: past days' queue lengths and claims are read from it.
- The day's slots are fixed at 00:00, so Shorts queued onto an empty queue wait for the next day, and a stream queued at lunchtime only raises the day after's count.
- Failed entries stay in `cvm short queue` and the Queue panel until they are taken off with `cvm short unqueue`, however long ago they failed.
- A day whose queue stayed empty claimed nothing but missed nothing: it never triggers catch-up.
- A channel that keeps failing costs its Short at most 3 tries, then the queue moves on. A post whose outcome is unknown waits for Matt and never blocks the queue.
- The `youtube-shorts` post check finds an upload by title, so two Shorts of the same title posted close together could confuse it. Held is the safety net.
