# Publish

Where a Draft Version becomes a Published Version: a Bundle of `.mp4` files and
a `course.json` committed to Dropbox.

## Sub-features

- **Version bump** — `Patch` / `Minor` / `Major`.
- **Description** — a required textbox; `Publish` stays disabled while it is
  empty.
- **To-do toggle** — `Include lessons marked to-do`, which changes the effective
  output and therefore the readiness numbers.
- **Autofill** — the hidden first step of `Publish`: pressing it starts an
  Autofill Job when Videos are missing a description or Chapters, and the
  Publish Job waits on it. The button reads `Filling…`, then `Publishing…`.
- **Pre-publish warnings** — the Publish Readiness lists.
- **Changelog preview** — the in-app diff against the last Published Version.

## How to get to it (user POV)

From the Course View, the `Actions` menu, then Publish. Or the route directly.

## Driving it with agent-browser

**Press `Publish` only on the Tiny Course, and only with a Dropbox stub.**
`$V tiny-course <run>` seeds it — one Section, Lesson, Video and Chapter, one
Clip of 2.5 seconds cut from footage it generates into the run's `scratch/` —
and prints its id. It writes as `cvm-verify-tiny-course` in the Ledger, so
seed before `guard baseline`; each call seeds a fresh one. Its Publish takes
about three seconds. A real Course's Publish encodes every Video it ships;
a clone run caps that at one ffmpeg (`FFMPEG_ENCODE_PERMITS`,
`FFMPEG_CPU_PERMITS`) and one upload (`DROPBOX_UPLOAD_CONCURRENCY`) at a time,
which makes it slower, not safe. It Submits the Draft, renders
Videos and commits a Bundle to Dropbox. It is a Job the run's sidecar runs
(the `publish` lane, one at a time, never re-run on its own), and on a clone
both Dropbox hosts reach only the discard port or a loopback stub you start
(`DROPBOX_API_URL`, `DROPBOX_CONTENT_URL`, see the skill) — confirm both in
`/proc/<pid>/environ` of the server and the sidecar before pressing. The clone
has no Dropbox token: `tiny-course` inserts a dud one, which reaches only the
stub. Without a stub it fails at the Commit and Discards its Pending
Version. Its rows are a parent row for the Course and one child row per
shipping Video in the Upload Manager; a Publish cut off mid-run reads
"Interrupted, and never re-run on its own" with **Promote or Discard on the
publish page**.
`Autofill` is a Job the run's sidecar runs; on a clone its model calls reach
only the discard port or a loopback stub you start (`ANTHROPIC_BASE_URL`, see
the skill), so press it only with a stub, and read the Videos back with
`$V sql`. The template may have no Autofill Candidates: clear a few Videos'
`video_description` on your clone first.

```bash
# AB="$V ab <run>" from the skill's launch step — this run's own browser and server.
$AB open "/courses/<courseId>/publish"
$AB wait --load networkidle
$AB snapshot -i -c -d 3
$V shot <run> publish
```

What proves it works: the snapshot shows `heading "Publish <course name>"`, the
three bump buttons, the description textbox, the to-do checkbox, and `button
"Publish" [disabled]` while the description is empty.

The `disabled` attribute on `Publish` is itself the useful assertion — it is how
you verify the gate without opening it.

## Gotchas

- This route also sets no document title.
- A Pending Version left at rest is reconciled **on page load** — opening the
  page can Promote or offer to Discard one. Opening it is therefore not purely
  read-only when a Publish crashed earlier. Check the Write Ledger after every
  visit to this route.
- The readiness numbers move with the to-do checkbox. Record which way it was
  set in your evidence, or the counts cannot be read back.
