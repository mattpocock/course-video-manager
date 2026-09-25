# Publish

Where a Draft Version becomes a Published Version: a Bundle of `.mp4` files and
a `course.json` committed to Dropbox.

## Sub-features

- **Version bump** — `Patch` / `Minor` / `Major`.
- **Description** — a required textbox; `Publish` stays disabled while it is
  empty.
- **To-do toggle** — `Include lessons marked to-do`, which changes the effective
  output and therefore the readiness numbers.
- **Autofill** — the same button reads `Autofill N Videos` while Videos are
  missing a description or Chapters, and `Publish` once none are.
- **Pre-publish warnings** — the Publish Readiness lists.
- **Changelog preview** — the in-app diff against the last Published Version.

## How to get to it (user POV)

From the Course View, the `Actions` menu, then Publish. Or the route directly.

## Driving it with agent-browser

**Read this page; press nothing on it.** `Publish` Submits the Draft, renders
Videos and commits a Bundle to Dropbox. `Autofill` spends Anthropic tokens
rewriting real Video descriptions and Chapters. Neither is undoable from here.

```bash
# $BASE and $AB come from the skill's launch step — this run's port and session.
$AB open "$BASE/courses/<courseId>/publish"
$AB wait --load networkidle
$AB snapshot -i -c -d 3
$AB screenshot "$VERIFY_RUN/publish.png"
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
