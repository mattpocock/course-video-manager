---
status: accepted
---

# The Dropbox bundle is the addressed unit, and its address is derived from Export Hashes

A **Publish** ships one self-contained **bundle**: a directory under
`{course}/versions/{versionFingerprint}-{assetFingerprint}/` holding every
shipping Video's `.mp4`, a `manifest.json`, and a `course.schema.json`. The
course root then gets a single `course.json` written with overwrite mode — the
commit receipt that names the bundle now current.

This ADR records why the _bundle_ is what gets a content-derived address (asked
for in #1355 when the layout landed in #1346 and never written), and why that
address is now derived from each Video's **Export Hash** rather than from the
SHA256 of its encoded bytes (#1495).

## Decision

- The unit addressed by a fingerprint is the **whole bundle**, not the
  individual Video file.
- The fingerprint is computed over the manifest schema, the course identifiers,
  the section tree, the to-do setting, and — per shipping Video — its position
  inside the bundle plus its **Export Hash**.
- The bundle is immutable. Same inputs produce the same path; a Video found at
  an existing address with a mismatched content hash or size is a hard failure,
  never an overwrite.
- The receipt is the only mutable object in the tree.

## Why the bundle, and not the individual file

Three properties are load-bearing, and all three are properties of the
directory rather than of any file in it:

- **Atomicity.** A consumer must never observe a half-published course. Every
  asset lands at an address nothing is reading yet, and exactly one final,
  atomic write — the `course.json` rename — makes the whole set visible at
  once. A partially uploaded bundle is invisible, not broken.
- **Immutability.** Publishing the same Course Version twice must land in the
  same place, and publishing anything different must land somewhere else. A
  previously published bundle is therefore never mutated: a changed to-do
  setting, a re-titled Video or an edited Clip all move the address instead.
- **Wholesale deletion.** Under the delete handshake agreed in #1352, the
  downstream consumer expires a release by deleting its bundle directory
  outright. This system has no delete role at all. That only works if a
  directory is exactly one release's assets and is shared with nothing.

## Why not a shared per-Video blob pool

A pool of content-addressed Video blobs, referenced by path from each
manifest, would deduplicate for free: a Video unchanged across ten releases
would be stored once instead of ten times. It was rejected anyway.

Deleting an expired release would then mean deleting only the blobs no
surviving release still references — cross-team reference counting, spread
across a producer and a consumer that agreed in #1352 precisely to avoid
having one. The consumer would have to understand which blobs a bundle owns
before it could delete anything, and this system would have to take on a
delete role it deliberately does not have. Storage is cheap; a cross-team
invariant that silently deletes a live asset when it is miscounted is not.

## Why the fingerprint comes from Export Hashes, not from bytes

The fingerprint originally included each Exported Video's SHA256 and byte
count. That made the bundle path a function of bytes on disk, so nothing could
be uploaded until every Video had been encoded AND read back to be hashed —
export and upload could never overlap, and the read pass was pure cost.

Each Video now contributes its **Export Hash** instead: the recipe the Exported
Video is addressed by locally — Clip filenames, source timings, Clip order,
Video Format, and the Export Version Key. Every ingredient is database state,
so the destination path is knowable before a single frame is encoded. That is
what lets a Video start uploading the moment its own export finishes, while
its siblings are still on the GPU (#1499).

All three properties above survive unchanged: the ingredients still cover
everything that distinguishes one release's output from another's, so
same-inputs-same-path and never-mutate still hold, and the directory is still
one release's assets.

**The accepted trade-off:** addressing by recipe means two files at one address
are asserted identical because they came from identical Clips and Video Format,
not because their bytes were compared. A change in the encoder that silently
alters output for unchanged input would reuse the existing address. The
**Export Version Key** already exists as the manual lever for invalidating
exactly that assertion, and the local Exported Video store has relied on the
same assumption since it was introduced — this change extends an existing
assumption to Dropbox rather than inventing a new one.

The downstream promise of a provable source revision is unaffected: the
manifest still carries each Video's exact SHA256 and byte count. Those are now
computed off the upload's own byte stream as it is written, so the guarantee is
kept without any file being read twice.

## Consequences

- A Publish interrupted partway leaves a real, resumable bundle: the listing
  says exactly which files are absent, and the next Publish uploads only those.
  Before, the incomplete directory made the Course Version permanently
  unpublishable.
- Re-publishing an unchanged Course Version still uploads no Videos.
- Export garbage collection must run after uploads finish, since it deletes by
  Export Hash reachability and cannot tell a file being streamed to Dropbox
  from an abandoned one.
