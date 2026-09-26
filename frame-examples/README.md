# Frame examples

The house style for **Clip Mockup** frames — the still images of a Video's
**Animatic**, captured by `cvm clip-mockup add --html <path>` at 1920x1080.

```
house.css        the contract
editor.html      a code editor: file tree, tabs, a diff, a squiggle, an error
terminal.html    a shell: a test run that fails
browser.html     dark chrome, a light docs page
title-card.html  the Definition Card's shape, blown up to fill a frame
diagram.html     boxes, arrows, one lit box, a hand-written aside
```

## The stylesheet is the contract. The markup is not.

`house.css` is the part that must not be rewritten. It holds the author's real
fonts, colours, spacing and code-token palette, and a frame that uses only what
is named in it reads as the author's own screen without anyone deciding
anything. Read its header comment: every value in it is traced back to where it
already lives in this repo.

The five `.html` files are **examples, not templates**. There is deliberately
no slot-filling system, because a real screen has a sidebar open, a diff, two
panes or an error, and a template would have refused all of them. Copy the
example nearest your moment, throw away the half of it you do not need, and
add whatever the moment really shows. Nothing reads these files at run time, so
nothing breaks when you change them.

## Writing a frame

1. Copy the example **and `house.css`** into your scratch folder, side by side.
   The pages link `./house.css` relative to themselves.
2. Edit the markup. Keep `class="frame"` as the outermost element: it pins the
   page to exactly 1920x1080 and CUTS anything that does not fit, so overflow
   is something you can see rather than something you discover in playback.
3. Put **real** content on it. A frame of grey placeholder boxes cannot be
   judged for density, which is the whole reason the author is watching.
4. Capture it, then **look at the PNG at full size** before you add the Clip
   Mockup. A frame with unreadable type is found here or at minute 26 of the
   playback.

## Point at the thing

A viewer gets about one second to find the part of the frame the line is
talking about. Make that free.

- **`.here`** on a code line: an accent wash and a bar in the gutter.
- **`.code--spotlight`** on the block around it: every line that is not
  `.here` fades back, so the rest reads as context.
- **`.spot`** around words in prose, a label or a heading: the same job,
  outside a code block. **`.spot--quiet`** is the losing side of a comparison.

Highlight the exact words the line says out loud, and nothing else. Two spots
on one frame means the frame is really two moments.

## Two things that have no build step

**Syntax highlighting is hand-written.** Each code line is a `.l` element and
each token is a `<span class="t-…">`; the `t-` classes are Shiki's
`vitesse-dark` scopes, the theme this repo's own code block already defaults
to. Nothing is highlighted at capture time, so there is no bundler, no
`<script>`, and no network round trip that could leave a frame half-painted.

**Fonts come from Google Fonts**, imported at the top of `house.css` — DM Sans,
Fira Code and Shantell Sans, exactly as the overlay renderer and the web app
already load them. The capture service waits for `document.fonts.ready`, so a
frame is never captured mid-swap. Every stack falls back to a system face, so
an offline capture is plainer but never broken.

## Sizes

A frame is watched on a laptop. 28px is the **smallest** type that belongs on
one and code is 30px. If a frame will not fit at those sizes, the frame is
holding too much: split the moment into two Clip Mockups rather than shrinking
the type.
