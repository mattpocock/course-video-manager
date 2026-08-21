---
status: accepted
---

# The Byte Hash decides what Dropbox receives; the Export Hash keeps the address

A **Publish** used to decide what to send from the **Export Hash** alone. The
reuse plan was keyed on it, so a **Video** whose Export Hash already appeared in
the previous **Bundle** was copied inside Dropbox and its encode was cancelled
before the GPU was touched, and the previous manifest's SHA256 was copied
forward into the new one.

That is sound only while the Export Hash predicts the bytes. It does not. The
Export Hash names what the renderer was told to do — Clip filenames, source
timings, Clip order, **Pause**, **Clip Zoom**, Video Format, and the Export
Version Key — and says nothing about what the renderer produced. A truncated
encode, or any re-export of unchanged Clips, lands at the same address as the
bytes it was meant to replace, so the correction could never reach the site: the
Publish copied the old bytes forward, cancelled the new encode, and wrote the
old SHA256 into the new manifest. Three of one course's 93 exports were short by
9.6s, 34.3s and 71.3s, and one of them was live (#1557).

This ADR records the division that fixes it, and why the two hashes must stay
apart.

## Decision

- The **Byte Hash** — the digest of an **Exported Video**'s real bytes, held in
  its Export Digest sidecar — decides whether a Video is sent or copied.
- The Export Hash keeps its two existing jobs: it names the Exported Video on
  disk, and it addresses the Bundle (ADR 0023, unaffected).
- The reuse plan is one map keyed on the Byte Hash. There is no second index on
  the Export Hash.
- No encode is ever cancelled. Every **Unexported Video** is exported, and a
  Video's copyability is settled only once its own export has landed.
- The manifest's SHA256 always comes from the local Export Digest, never from
  the previous manifest.
- The copy batch is issued once, after the export pool has drained and the
  upload pool has finished — the earliest moment the whole copyable set is
  known. A refused or unlaunchable batch falls back to upload.
- An export shorter than its Clips ask for, by more than one second, is refused
  before it becomes an Exported Video.

## Why the two hashes must not be merged

The obvious simplification is one hash doing both jobs. It cannot exist.

The Bundle address must be knowable **before** any encoding begins. That is what
lets a Video start uploading the moment its own export finishes while its
siblings are still on the GPU, and it is why ADR 0023 derives the address from
database state rather than from bytes. A Byte Hash is knowable only **after**
the encode. Address by bytes and export and upload can never overlap again;
decide the send by recipe and a corrected export can never be sent. The two
questions are asked at different times, so they need different answers.

Keying the plan on the Byte Hash also buys something the Export Hash could not:
a Video is copyable from **any** identical file in the previous Bundle, not only
from the one at its own Export Hash. Two Videos with identical bytes cost one
upload between them.

## Why not an export generation counter

The alternative considered was to make the Export Hash honest about a
re-export: store a per-Video export generation in the database, bump it on every
**Purge**, and feed it into the Export Hash. A re-export would then get a new
Export Hash, a new address, and no reuse match.

It was rejected on three counts. It needs a schema migration for what is a
release-time concern. It breaks "same inputs, same address" — the property ADR
0023 rests on — because the address would then depend on how many times the
author had purged rather than on what the Video is. And it is blind to the case
that caused this: bytes that differ without a Purge, such as an encode that was
truncated the first time and complete the second. A counter records that
somebody deleted a file; only the bytes record what the file contains.

## The measurement this rests on

The saving only survives because the encode is reproducible: the same Video,
exported twice, must give the same Byte Hash, or every Publish would upload
everything. This was measured on the author's machine with the exact arguments
the single-pass concat builds — nvenc, preset slow, vbr, cq 19, cfr 60, and the
bitexact flags:

- The same encode run twice produced the same SHA256.
- The audio normalisation pass run twice produced the same SHA256.
- Six encodes run at once on the one GPU — the real six-way export
  concurrency — produced the same SHA256 as the serial run. All seven agreed.
- Removing the bitexact flags did not break reproducibility within one ffmpeg
  build.

That last point is what `BITEXACT_ARGS` is for: it does not make one machine
stable, it protects reproducibility across an ffmpeg or driver upgrade. Anything
that removes those flags gives up the copy saving on the next upgrade, and the
first symptom is a Publish that uploads a whole course it used to copy.

The footage was short and synthetic. This is strong evidence, not proof for a
13-minute Video — and it does not need to be proof, because the cost of being
wrong is an upload, not a wrong release.

## Consequences

- A corrected export reaches Dropbox, and the manifest names the bytes actually
  shipped.
- A Publish where nothing changed still sends no video bytes: every Video is
  re-encoded, every Byte Hash matches, and one copy batch does the rest.
- Reclaiming disk space costs an encode, not an upload. A Publish whose exports
  the garbage collector took re-encodes them and then still copies.
- The GPU does more work than before, because no encode is cancelled. That is
  the price of never deciding the send from something other than the bytes.
- Byte-weighted progress counts every Video as uploading, since which ones are
  copyable is unknown until their exports land. A denominator that shrank under
  a running percentage would make it go backwards.
- The `upload-videos-reused` event, which announced the whole reused set
  upfront, is gone. The per-Video `upload-video-reused` event replaces it.
- The Export Digest sidecar now also carries the measured duration, so the
  truncation check costs one ffprobe the first time and nothing afterwards. A
  sidecar written before this change parses as absent and is replaced.
