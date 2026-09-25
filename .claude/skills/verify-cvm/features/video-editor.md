# Video Editor

One Video's Clips on a timeline, with its Script, Beats and overlays.

## Sub-features

- **Clip list** — one `First frame <timestamp> <transcript text>` button per
  Clip, in order.
- **SCRIPT / BEATS tabs** — switch the right-hand panel between the Video's
  Script and its Beat plan.
- **Edit / Open in writer** — the editing surfaces for the Video's body.
- **Playhead** — a `slider` carrying the current time in seconds.
- **Actions menu** and **Post** — Actions holds the destructive verbs; Post
  opens the social publishing flow. Both WRITE.

## How to get to it (user POV)

From `/shorts` or `/videos`, click a Video; or from a Lesson's Video in the
Course View.

## Driving it with agent-browser

```bash
AB="agent-browser --session verify-cvm"
$AB open http://localhost:5199/videos/<videoId>/edit
$AB wait --load networkidle
$AB find role button click --name "BEATS"
$AB snapshot -i -c -d 3
```

Get a `<videoId>` off the Shorts list:

```bash
$AB open http://localhost:5199/shorts
$AB snapshot -i -u -d 2 | grep -oE 'videos/[0-9a-f-]{36}' | head -1
```

What proves it works: the Clip buttons carry real transcript text, and the panel
content changes when you switch SCRIPT and BEATS.

## Gotchas

- **The first visit breaks.** This route pulls in tldraw, Remotion and Monaco,
  so Vite optimises the dependencies mid-render, reloads, and React dies with
  `Cannot read properties of null (reading 'useRef')`. The page reads
  "Something went wrong". This is the dev server warming up, not a bug in the
  app. Wait a few seconds and `$AB reload`; it comes back whole. Confirm before
  you report a failure here.
- **This route sets no document title**, so `get title` returns empty even when
  the page is healthy. Check `get url` and the `heading` in the snapshot instead.
- `$AB errors` is empty on the broken render — the failure surfaces as page text,
  not as a console error. Read `$AB get text body` when a page looks blank.
