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
   - once a day minimum: every day has at least its 13:00 slot, even when the queue was empty at 00:00; the 00:00 count only decides whether a weekday gets 2 slots (more than 14 queued) or 3 (more than 21); Saturday and Sunday always 1;
   - a slot posts the oldest Short in the queue AT the slot: a Short queued at 10:00 on a day that began empty goes out at 13:00 that day, one queued after 13:00 waits for the next day's slot;
   - slot times live in one constant: 1/day 13:00; 2/day 09:00 and 18:00; 3/day 09:00, 13:00 and 18:00, as UK wall-clock times turned into instants across the clock changes (none falls in the 01:00–02:00 hour the clocks skip or repeat);
   - catch-up: a weekday after a day that had a Short to post (one was in the queue at its first slot) and claimed no slot takes the next pattern up, one extra Short at most, and 3 stays 3. Monday looks back over Friday, Saturday and Sunday; the weekend never catches up;
   - a slot missed earlier in the day is claimed at the next check, one claim per check and only once the previous claim has settled; a slot not claimed by the end of its UK day is dropped.
     The same function answers "what is due now?" for the Sidecar and "when does each Queued Short go out?" for `cvm short queue`, `cvm short post --dry-run` and the Shorts page, so they cannot disagree.
6. **Order is oldest first**, by a Fractional Index that moving a Short changes.
7. **`cvm short post` checks every Short before it queues any**: a Landscape Video, a default title, no description, a live entry and a Short already Posted on both channels are each refused (exit 3), and one refusal queues none of the batch. It is local-only, because only this machine's Sidecar posts.

8. **The Posting Queue tick posts it** (#2614). It is a Sidecar loop of its own, every `postingQueueTickMs` (2 minutes), reading the time from Effect's `Clock`. It runs only in the author's MAIN CHECKOUT, detected as the live desk detects it (`isMainCheckout`): a worktree's or a verify-cvm clone's Sidecar never posts. Each tick:
   - marks Posted every Posting entry whose Short has a posted `youtube-shorts` AND a posted `buffer` Video Post written since it claimed its slot ("Posted" is derived, never set by a Job);
   - asks the Slot Schedule what is due, and claims it in ONE transaction, under a lock every claim takes, asking the Slot Schedule again inside it: the entry becomes Posting with its slot, and one `youtube-shorts` and one `buffer` Job are enqueued, each carrying the entry id. A crash before the commit did nothing; after it, the slot is claimed and the Jobs exist, so no tick claims it again, and the Slot Schedule claims nothing while an entry is Posting.
   - The posting Jobs read the Short's title and description from the Video when they run (TikTok's caption is the title), so an edit after queueing is what goes out. They stay posting kinds: one attempt, never re-run on their own.
   - A Short whose vertical export is stale is rendered just in time (#2615): stale means no export, no Short Export Hash file beside it (`{videoId}.mp4.export-hash`, written by the render), or a different hash. The claim's transaction then also enqueues a `render-vertical` Job, and both posting Jobs wait on it (`dependsOn`), so a render that fails for good posts nothing. Until #2618 counts that as a failure per channel, the entry stays Posting and the tick writes the render's reason on it.

## Considered

- **Buffer's own queue (spec #2564).** Rejected: 10 scheduled posts per channel on the free plan, and a file uploaded days ahead is deleted by the 1-day lifecycle rule before Buffer fetches it.
- **TikTok's Content Posting API.** Rejected: private posts only without an audit that rejects own-account tools.
- **YouTube `publishAt`.** Rejected: CVM posts both channels at the same slot, and "Posted" means live everywhere.
- **Storing each day's slot count.** Rejected: it is derivable from the entries' history, which also covers a day CVM was off.

## Consequences

- An entry is never deleted while it can matter to the schedule: past days' queue lengths and claims are read from it.
- A Short queued before 13:00 on a quiet day goes out the same day; the day's slot COUNT is still fixed at 00:00, so a stream queued at lunchtime only raises the day after's count.
- A day whose queue stayed empty claimed nothing but missed nothing: it never triggers catch-up.
- How a failed channel is retried, Held and Failed, and their amendment to ADR 0032's "a post never runs again on its own", are decided by #2618. Until then a posting Job that fails leaves its entry Posting, which holds the queue.
