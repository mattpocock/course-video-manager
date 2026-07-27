# Teleprompter — PROTOTYPE

**Throwaway.** Everything under this directory, plus
`app/routes/teleprompter-prototype.tsx`,
`app/routes/api.teleprompter-prototype.$videoId.content.ts`,
`app/lib/teleprompter-prototype-{protocol,window}.ts`, and the four
`teleprompter-*` Stream Deck actions, exists to answer design questions. None of
it should be promoted as-is — when a shape wins, rewrite it properly.

## The questions

1. **Beats or Script on the glass?** Visible tab, top-left of the control bar. A
   video with a script opens on the script; one without falls back to its beat
   plan. Picking the tab by hand pins it until you move to another video.
2. **Which reading model for prose?** Three variants, `?variant=A|B|C`.
3. **What does the type want to be?** Every knob is in the tuning popup, so this
   is settled by moving sliders rather than by describing it.

A focus reticule was tried and cut — the eyeline sat fine without one.

## Running it

`pnpm dev`, open a video in the editor, then **Actions → Open Teleprompter
(prototype)**. The popup opens at 1024×600 — the Elgato Prompter's panel size —
so what you tune is what you get on the glass.

Drag it onto the Prompter in Camera Hub's Display mode. **Leave Mirror off:**
Elgato mirrors the display automatically, so enabling it here double-flips and
the text becomes unreadable. The toggle exists only as an escape hatch.

## Controls

| Action         | Keyboard            | Stream Deck (or pedal)                    |
| -------------- | ------------------- | ----------------------------------------- |
| Advance        | `J` / `↓` / `Space` | `localhost:5174/api/teleprompter-advance` |
| Back           | `K` / `↑`           | `…/api/teleprompter-back`                 |
| Play-pause     | `P`                 | `…/api/teleprompter-toggle-play`          |
| Reset to top   | `R`                 | `…/api/teleprompter-reset`                |
| Change variant | `←` / `→`           | —                                         |

In Beats you can also click a beat to move the spotlight straight to it. The
keyboard only works when the popup has OS focus, which it won't while you're
looking at the Prompter — so the Stream Deck, or a click, is the real way in.

Configure a Stream Deck button as a **Website / System: Open** action pointing at
the URL, exactly as the existing forwarder actions are set up (see
`stream-deck-forwarder/README.md`). The pedal is an Elgato device routed through
the same Stream Deck software, so it needs no separate handling.

What play-pause _means_ differs per shape, deliberately: crawl rolls/stops,
stepper auto-advances, band drifts slowly, beats toggles descriptions.

## Design notes

**No picker, and no videoId in the URL.** The window shows whatever the Video
Editor currently has open, learned over BroadcastChannel, and shows an empty
state when the editor has none. The editor is unconditionally the source of
truth. Content is then polled from
`/api/teleprompter-prototype/:videoId/content` every 3s so script and beat edits
appear without a reload.

**Nothing flows back.** The teleprompter never reports position to the editor.
(Worth knowing: the real Beats tab already tracks per-beat completion in
localStorage and never persists it — so if position tracking ever becomes
interesting, that's the seam.)

**Capture state is mirrored, not reinvented.** `capture-indicator.tsx` copies the
icons, colours and state names from
`app/features/video-editor/components/live-media-stream.tsx` verbatim. If that
badge changes, this must change with it.

**Beats get one view, not three.** Beats are ~12 short Title-Case labels with a
sentence of description each. A continuous crawl through twelve bullet points is
meaningless, so `beats-view.tsx` is the single sensible shape: whole plan
visible, current beat spotlit and expanded, kind icons imported from the real
Beats tab so it reads the same as the editor.

## When it's done

Fold the winner into real code, then move this whole prototype onto its
throwaway branch rather than leaving the losing variants in main — they rot fast
and confuse the next reader. Record the verdict, and the question it settled, on
the implementation issue.
