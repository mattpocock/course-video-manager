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
   - weekdays: 1 slot, 2 when more than 14 are queued, 3 when more than 21; Saturday and Sunday always 1; an empty queue none;
   - slot times live in one constant: 1/day 13:00; 2/day 09:00 and 18:00; 3/day 09:00, 13:00 and 18:00, as UK wall-clock times turned into instants across the clock changes (none falls in the 01:00–02:00 hour the clocks skip or repeat);
   - catch-up: a weekday after a day that had at least one slot and claimed none takes the next pattern up, one extra Short at most, and 3 stays 3. Monday looks back over Friday, Saturday and Sunday; the weekend never catches up;
   - a slot missed earlier in the day is claimed at the next check, one claim per check and only once the previous claim has settled; a slot not claimed by the end of its UK day is dropped.
     The same function answers "what is due now?" for the Sidecar and "when does each Queued Short go out?" for `cvm short queue`, `cvm short post --dry-run` and the Shorts page, so they cannot disagree.
6. **Order is oldest first**, by a Fractional Index that moving a Short changes.
7. **`cvm short post` checks every Short before it queues any**: a Landscape Video, a default title, no description, a live entry and a Short already Posted on both channels are each refused (exit 3), and one refusal queues none of the batch. It is local-only, because only this machine's Sidecar posts.

## Considered

- **Buffer's own queue (spec #2564).** Rejected: 10 scheduled posts per channel on the free plan, and a file uploaded days ahead is deleted by the 1-day lifecycle rule before Buffer fetches it.
- **TikTok's Content Posting API.** Rejected: private posts only without an audit that rejects own-account tools.
- **YouTube `publishAt`.** Rejected: CVM posts both channels at the same slot, and "Posted" means live everywhere.
- **Storing each day's slot count.** Rejected: it is derivable from the entries' history, which also covers a day CVM was off.

## Consequences

- An entry is never deleted while it can matter to the schedule: past days' queue lengths and claims are read from it.
- Queueing on a day whose queue was empty at 00:00 posts nothing until the next day, by design: the day's plan is fixed at its start.
- How a failed channel is retried, Held and Failed, and their amendment to ADR 0032's "a post never runs again on its own", are decided by the tickets that build the posting (#2614, #2618).
