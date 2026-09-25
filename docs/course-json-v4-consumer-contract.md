# course.json v4 — what the consumer must change

> For the team that owns the site that syncs a published course. You do not need
> to read this repository to act on this note.
> Last updated: 2026-09-25

## Context

The Course Video Manager publishes a course as an immutable **Bundle** — the
exported `.mp4` files, a `course.json` manifest and its generated
`course.schema.json` sidecar — and then writes the `course.json` at the Dropbox
course root as the commit receipt. Your sync reads that manifest.

Today a **Lesson** reaches the manifest only when it is complete: it has a
**Video** with an exported `.mp4`, a `body` and a `description`. A Lesson with
no Video is dropped from the release, and a Lesson with an incomplete Video
fails the Publish outright. That is the right rule after a course launches. It
is the wrong rule before launch, when the author wants a learner to read the
titles of the lessons he has not filmed yet.

So the manifest gains a third kind of Lesson — a **Placeholder Lesson**, which
carries a title and nothing else — and the manifest format moves from version 3
to version 4.

We do not own your side. Nothing reaches a learner until your sync accepts v4.

## What changes in the manifest

### 1. A third member of the Lesson union

The `lessons` array of a section holds a discriminated union, keyed on `type`.
It has two members today, `"explainer"` and `"problem"`. It gains a third:

```json
{
  "type": "placeholder",
  "id": "lesson-lineage-id",
  "title": "The lesson title shown to learners"
}
```

Exactly three keys. There is no `description`, no video key, and no other
field. Do not expect one to appear later; adding an absent key is a change we
can make safely, and we will tell you if we make it.

### 2. `schemaVersion` becomes `4` on every manifest

```json
{
  "$schema": "versions/<course-version-id>-assets/course.schema.json",
  "schemaVersion": 4,
  ...
}
```

The version is stamped `4` from the moment the producer change lands — on every
manifest, whether or not it holds a Placeholder Lesson. The producer stamps what
the producer produces; it does not compute the lowest version that could decode
the document.

**Please accept both `3` and `4` during the changeover window.** A manifest
already sitting at a Dropbox course root stays at version 3 until that course is
published again, and the author publishes each course by hand, one at a time. If
your side rejects 3, every course that has not been republished stops syncing.

### 3. Nothing else changes

Every field on a shipping Video stays **required and non-nullable** —
`relativePath`, `body`, `description`, `hash`, `sha256`, `bytes` and
`chapters`. The `"explainer"` and `"problem"` members are untouched, and
`solution` on a `"problem"` Lesson keeps its one meaning: the key is absent when
the lesson has no worked solution by design. We are not relaxing any existing
member to let a video go missing. A Lesson is either whole or a Placeholder
Lesson.

The section shape, the course fields, `archiveTTL` and the `$schema` pointer are
all unchanged.

## What your side must change

1. **Decode the `"placeholder"` member.** Accept the three-key object above
   wherever you decode a Lesson today.
2. **Accept `schemaVersion` 3 and 4** until you retire 3. See the note on
   retirement below.
3. **Create the target resource with an empty `body` and an empty
   `description`.** A Placeholder Lesson has no article. Do not invent one, and
   do not leave the previous text in place.
4. **Set the sync metadata lesson type to `placeholder`.** Your rendering
   choice — "coming soon", a locked row, a dimmed title — is yours to make. The
   contract only names the type.
5. **Create no video children** for a Placeholder Lesson. There is no `.mp4` in
   the Bundle for it.
6. **Remove the "lesson has no importable video" throw.** A Lesson with no
   importable video is now a legal, expected state, not a fault. If that throw
   stays, every release that announces a placeholder fails your import.
7. **Tolerate a release with no `.mp4` files at all.** A syllabus-only release
   — every section present, every lesson a Placeholder Lesson — is legal, and it
   is the case the author wants first.
8. **Tolerate a section whose every lesson is a Placeholder Lesson.** It ships.
   A section with nothing in it at all is still dropped from the manifest, as
   today.

## Identity: a Placeholder Lesson keeps its lineage id

The `id` on a Placeholder Lesson is the same **lineage id** the Lesson carries
across course versions. It is the same id the Lesson will carry when it later
ships in full.

So when the author films the lesson and publishes again, the `"placeholder"`
member is replaced by an `"explainer"` or `"problem"` member **with the same
`id`**. Your side must update the same target resource rather than create a
second one. If you derive identity from the lineage id already, nothing changes
here — this is a statement of what you can rely on, not a request.

One consequence worth knowing: if your slug comes from the id and the title, and
the author edits the title while the lesson is a placeholder, the URL moves. We
are not guarding against that on our side.

## Deploy order

**Merging the producer change breaks nothing on its own.** The `course.json` at
each Dropbox course root keeps its existing v3 content until that course is
published again, and a Publish is a deliberate, manual act on the author's
machine. There is no scheduled job that will push a v4 manifest at you.

The rule for the author is therefore one sentence:

> Do not publish a course until v4 support is live on the site.

The order is:

1. Merge and deploy the producer change (this repository). Nothing on the site
   changes.
2. Ship your v4 support, accepting both 3 and 4. Still nothing on the site
   changes.
3. The author publishes. The first v4 manifest reaches the site.

Steps 1 and 2 can happen in either order, or at the same time. Step 3 must come
after step 2. There is no window in which a half-deployed pair of repositories
serves a broken course.

One operational note, in case you watch the Bundle addresses: the generated
`course.schema.json` is an input to the Bundle address, so adding the union
member re-addresses every Bundle. The first v4 Publish of each course uploads
every `.mp4` once more, to a fresh address. Nothing is overwritten, and no
previous Bundle is removed by us.

## Retiring v3 is your schedule

We are not setting a date for dropping version 3. Accept both for as long as you
want to. Once every course you care about has been published under v4, you can
drop 3 whenever it suits you, and you do not need to tell us first — the
producer only ever emits 4 from now on, so a v3-refusing consumer and this
producer agree by then.

## Questions

Raise an issue on `mattpocock/course-video-manager`. The manifest is produced by
a single module in that repository, and its JSON Schema sidecar
(`course.schema.json`) is generated from the same source, so the sidecar shipped
beside any `course.json` is always an exact description of that document. If you
want a machine-readable contract rather than this note, read the sidecar.
