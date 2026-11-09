---
status: accepted
---

# A clipless Video with a Body ships as a Text Lesson, and the manifest version is the lowest one that describes it

Decided on 2026-11-09 by Matt's chief of staff, from Matt's decisions on FAQ lessons (spec #2694, ticket #2696). Matt may overrule it.

## Context

Matt wants an FAQ in each Section that has had learner questions: one Lesson, a written page of questions and answers, that nobody films. His decision: the Lesson still has a **Video**, but that Video need not have **Clips** as long as it has a **Body**.

Until now a Video with no Clips was a **hard gap** (ADR 0029), so such a Lesson was withheld or shipped as a **Placeholder Lesson**, title only. And every Video entry in `course.json` must carry an exported `.mp4`, its Export Hash and its byte receipt (ADR 0019), none of which a written lesson has.

The site that reads `course.json` decodes strictly: an unknown key or Lesson type fails the decode. It is built by another team, on its own schedule.

## Decision

1. **A Text Lesson is a Lesson whose only active Video has no Clips and has a Body.** For it, "no Clips" is not a hard gap, so its Lesson Publish Status is `ships`. A Lesson with two or more active Videos where any has no Clips keeps the hard gap. A clipless Video with no Body keeps both gaps. The rule lives in the classifier, once (`isTextLesson`).
2. **It reaches `course.json` as a fourth Lesson member**, `{ type: "text", id, title, body, description }`. No video key. ADR 0019 holds: every field is required and non-null. The description is still checked by the build's gate and written by Autofill from the Body.
3. **It ships no bytes.** A third walk, `computeAssetSections` (the shipping Lessons less Text Lessons), feeds export, the video roster, the Dropbox upload and the Bundle's video entries. Gap checks and Autofill keep reading `computeShippingSections`.
4. **The manifest version is chosen per document: the lowest version that can describe it.** `courseJsonSchemaVersion` returns 5 when the release reaches a Text Lesson, else 4. `buildCourseJson` stamps it, and the Dropbox publish picks the sidecar (`course.schema.json`) by it before the Bundle address is computed. Version 4's document schema is unchanged, and version 5 is version 4 plus the new member.

## Why

- **The per-document version reverses the v4 stance on purpose.** The v4 change stamped `4` on every manifest from the moment it merged ("the producer stamps what the producer produces"). Doing that again would move every Course to version 5 at once, and every Publish would fail at the site until the site shipped. Choosing the lowest version keeps a Course that uses nothing new byte-identical to today: same `course.json`, same sidecar, so the same Bundle address and no re-upload. A golden-file test (`course-json-v4-golden.test.ts`) holds that.
- **One function, two readers.** The sidecar has to be chosen before the manifest is built, because it feeds the Bundle address the manifest's `$schema` names. Having the publish and the builder ask the same pure function means the stamp and the sidecar cannot disagree.
- **A separate asset walk, not a filter at each call site.** Four places export or upload Videos; one walk stated once keeps them in step, as ADR 0029 did for the Placeholder Lesson.
- **A Lesson, not a Video, is the Text Lesson.** The site creates lesson resources, not video ones, for it; and if the author later films it, the Lesson ships as an explainer with the same lineage id, so the site updates one resource.

## Consequences

- A Video whose Body was written before any Clip was recorded now ships as a Text Lesson rather than being withheld. The to-do setting still withholds a Lesson that is not marked done.
- Do not publish a Course holding a Text Lesson until the site accepts version 5. Courses without one are unaffected.
- The Optional Lesson (ticket #2695) extends the version 5 schema and the same version rule.
