---
status: accepted
---

# A Lesson nobody has filmed ships as a Placeholder Lesson, gated by a Placeholder Floor

A **Publish** no longer refuses a release because a **Lesson** is unfinished. Every Lesson in a release now has a **Lesson Publish Status** — `ships`, `placeholder`, or `withheld` — computed in one walk by one classifier. A Lesson whose status is `placeholder` reaches `course.json` as a **Placeholder Lesson**: a third member of the Lesson union carrying a title and nothing else.

```json
{
  "type": "placeholder",
  "id": "lesson-lineage-id",
  "title": "The lesson title"
}
```

Exactly three keys. No video, no `body`, no `description`. The `id` is the Lesson's lineage id, exactly as on the two existing members, so a Lesson filled in later updates the same target resource downstream rather than creating a second one. `schemaVersion` becomes `4` on every manifest, and the generated `course.schema.json` sidecar follows automatically, because it is `JSONSchema.make` of the very schema that types the document.

Which unfinished Lessons are announced is chosen by the **Placeholder Floor**: the lowest **Lesson Priority** band whose unshippable Lessons ship as Placeholder Lessons. Four positions — announce nothing (the default), P1, P2, P3 — compared numerically as `priority <= floor`.

## Why this shape

- **The pre-launch window is the one case the old rules got wrong.** A Lesson with no **Video** was elided and a Lesson with an incomplete Video failed the Publish outright (ADR 0019). Both rules are right after a Course launches, because they are what make a Lesson show up properly on the site. Both are wrong before launch, when the author wants a learner to read the titles of the Lessons he has not filmed yet. The preview has to travel through the real pipe — Publish → `course.json` → Dropbox → the sync — because the rows must sit in the real Course tree beside the finished Lessons.

- **A hard gap is a gap Autofill cannot close.** Exactly three: the Lesson has no active Video; a Video has no **Clips**; a Video has no `body`. A missing `description` and missing **Chapters** are not hard gaps, because **Autofill** writes both — a gap Autofill can close never makes a Lesson a Placeholder Lesson, so a Lesson one press from complete is never announced as unfilmed. An **Unexported Video** is not a gap at all, because Publish renders it as its export stage.

- **A Lesson is all-or-nothing.** One hard gap on any active Video gives the whole Lesson the status `placeholder`. A Lesson that simply holds no solution Video keeps shipping as it does today, so an absent `solution` keeps its one meaning: this Lesson has no worked solution by design.

- **The floor beats the to-do toggle inside the bands it names.** Read the pair as "withhold to-do Lessons, except announce the P1s and P2s". The two controls stack rather than replace each other; the toggle keeps its own remaining job, withholding a Lesson that is shippable but not yet marked `done`.

- **One classifier, not two predicates.** The publish page's numbers and the manifest's contents must come from the same walk. ADR 0019 introduced a single shared collector for exactly this reason, and a second predicate beside the old boolean would let the two drift apart again. `classifyLessonPublishStatus` is that one notion, and the effective-output filters are only its application to the tree: `computeEffectiveSections` is every Lesson the release reaches (the manifest's tree), `computeShippingSections` is only the Lessons that ship in full (the asset set).

- **Nothing fails for being unfinished; everything is visible.** `IncompleteVideosError` is retired. A hard gap decides a status and appears in a list the author reads before pressing the button. Two release-stopping failures are left, and neither is about an unfinished Lesson: an invalid Lesson role combo, because roles are then ambiguous and there is no honest node to emit, and a shipping Video with no `description`, because that is the one gap which is neither announceable nor emittable.

- **ADR 0019's no-null rule survives intact.** The two existing Lesson members are untouched: every field on a shipping Video stays required and non-nullable. What changes in ADR 0019 is its consequence, not its reasoning. `body` and Clips are now guaranteed by the classifier, because they are two of the three hard gaps. A missing `description` is guaranteed by a narrower throw of its own, `IncompleteShippingVideoError`, inside `buildCourseJson` — because a missing `description` is NOT a hard gap, so no floor position can announce the Lesson instead, and the only alternative to refusing is a `null` in the manifest. The gate lives inside the builder rather than only in the publish page's lint gate so that it holds on EVERY path into a manifest, including the standalone Dropbox re-sync, which runs no lint gate and would otherwise overwrite a live `course.json`. The lint gate still refuses earlier, before any byte is uploaded; the builder is the invariant behind it.

- **The floor joins the Bundle address explicitly** (ADR 0023), beside the to-do setting and for the same belt-and-braces reason. The floor genuinely changes the shipped asset set: a Lesson holding one sound Video and one gapped Video becomes a Placeholder Lesson and ships neither. The shipping Videos would move the address anyway; naming the control means two floor positions on one **CourseVersion** can never collide at one address.

- **A syllabus-only release is legal.** A manifest of Sections and bare titles with zero `.mp4` files commits: the upload pool has no work, export garbage collection has nothing to reclaim, and the atomic `course.json` rename is the whole release.

- **The version is stamped 4 always,** not only when a Placeholder Lesson is present. A content-derived version — "the lowest version that can decode this document" — would have let the two repositories deploy on independent schedules. The producer stamps what the producer produces, and the author controls the window anyway by choosing when to publish. Merging this breaks nothing on its own: the `course.json` at each Dropbox course root stays v3 until that Course is published again, and a Publish is a deliberate, local act. See `docs/course-json-v4-consumer-contract.md`.

## Considered alternatives

- **Recording the floor on the Published Version.** Rejected: the floor is a per-browser, per-Course UI preference, not release data. The consequence accepted with it is that the changelog gains no "now available" bucket, because the transition from Placeholder Lesson to full Lesson cannot be derived from the snapshots alone. An in-flight retry or resume therefore carries the floor in its own request, from the client that still holds it — the floor is inside the Bundle address, so a retry that forgot it would address a different Bundle and commit a manifest missing its Placeholder Lessons. A cold manual re-sync, with no client to ask, announces nothing.

- **Refusing a Publish that would replace a complete Lesson with a Placeholder Lesson,** and so blank an article already live on the site. Technically detectable from the previous Published Version, and judged not to arise in practice.

- **A `description` on the Placeholder Lesson node.** Rejected: adding an absent key later is a two-way door; taking one out is not.

- **Relaxing the two existing Lesson members** to allow a missing video. Rejected: that would re-create exactly the fake optionality ADR 0019 deleted.

- **A check constraint on `lessons.priority`.** Rejected here: a separate tidy-up with its own small risk on live data. Because the floor compares numerically, an out-of-range Priority simply sorts where its number puts it — no migration, no new failure.

- **Vocabulary.** "Publish Fate" (too dramatic), "announced" as the middle status value (confusing beside "Placeholder Lesson"), and "Coming Soon Lesson" (that is the consumer's rendering choice, not the contract's word).

## Consequences

- `schemaVersion` reads `4` on every manifest from the moment this lands. The consumer must accept both 3 and 4 during the changeover window; retiring 3 is the consumer's schedule.
- The generated schema document is inside the Bundle address hash, so adding the union member **re-addresses every Bundle**. The first v4 Publish of each Course re-uploads every `.mp4` once, to a fresh address. Nothing is overwritten and no previous Bundle is removed.
- A Lesson is all-or-nothing, so adding one unfilmed Video beside a finished one withholds the whole Lesson from the release — and from the export queue and the Autofill count with it. That is the point of the rule, and the withheld list is where the author reads it.
- Course-view lints, **Video Warnings** and the Lesson role-combo check are computed only over the Lessons that ship, so a half-planned Video can no longer refuse a pre-launch release.
- `buildCourseJson`'s error channel keeps `InvalidLessonRoleComboError` and replaces `IncompleteVideosError` with the narrower `IncompleteShippingVideoError`, which can now only mean a missing `description`. `collectPublishBlockers` still enumerates `incompleteVideos`, but only over shipping Lessons — so the publish page warns about exactly what the builder would refuse.
