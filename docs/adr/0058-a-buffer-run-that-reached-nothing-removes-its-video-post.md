---
status: accepted
---

# A Buffer run that reached nothing removes its Video Post

Decided on 2026-11-03 by Matt's chief of staff, from the code review of the Posting Queue (spec #2612, #2618). Matt may overrule it.

## Context

The `buffer` Job kind writes a `video_post` row before it uploads the Short to S3 and asks Buffer to post it. Its read-only post check (`checkPosted`) asks Buffer nothing. It reads that row: a remote id means posted; a row without one means Buffer may have the post, so "unknown"; no row means not-posted. Before the Posting Queue, a failed Buffer run always left its row behind, so every failure checked as unknown. The Posting Queue retries a channel only when the check says not-posted (ADR 0057, item 9). With the old behaviour, a Buffer failure could never be retried, only Held for Matt.

## Decision

When a Buffer run knows nothing reached Buffer, it deletes its own unposted Video Post (`deleteUnpostedVideoPost`), so the unchanged check says not-posted. It knows this when:

- the S3 upload failed (Buffer was never told of the file);
- Buffer refused the post (a 4xx, a GraphQL error, or a `MutationError`);
- the Buffer key is dead (`BufferAuthError`).

Any other failure (a 5xx, no answer, a cut-off run) keeps the row, so the check still says unknown and the entry is Held.

## Considered

- **Change the `buffer` check to tell refusals from cut-offs.** Rejected: #2612 says the checks are reused as they are, and the row is already what the check reads.
- **Keep every row, and Hold every Buffer failure.** Rejected: a busy or refusing TikTok would Hold every Short and stop the retries the spec asks for.

## Consequences

- A refused or never-uploaded Buffer post leaves no `video_post` row. The Shorts page and `cvm` see no TikTok attempt for it, which is true: nothing reached Buffer.
- This changes what an existing kind's failure leaves behind, for every caller of the `buffer` kind. Only the Posting Queue enqueues it now.
