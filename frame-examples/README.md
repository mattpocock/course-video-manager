# Frame examples

The house style for **Clip Mockup** frames — the still images of a Video's
**Animatic**, captured at 1920x1080 from an `"html"` entry of `cvm clip-mockup add`.

```
house.css        the contract
editor.html      a code editor: file tree, tabs, a diff, a squiggle, an error
terminal.html    a shell: a test run that fails
claude-code.html a Claude Code session: prompt, reply, tool calls, input box
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

The six `.html` files are **examples, not templates**. There is deliberately
no slot-filling system, because a real screen has a sidebar open, a diff, two
panes or an error, and a template would have refused all of them. Copy the
example nearest your moment, throw away the half of it you do not need, and
add whatever the moment really shows. Nothing reads these files at run time, so
nothing breaks when you change them.

## Class index

Every class `house.css` gives an author, and what it does. Read the stylesheet
only for a value; read this for a name.

```
FRAME     .frame            outermost element: exactly 1920x1080, overflow CUT
          .frame--center    one centred thing (title card, diagram), 96px gutter
          .frame--full      one window filling the frame, no padding
          .frame--inset     one window floating on the ground, 64px padding
WINDOW    .window           a window (border + shadow inside .frame--inset)
          .titlebar .title  its top bar and title text
          .lights           the three macOS buttons: <div class="lights"><i></i><i></i><i></i></div>
          .panes            sidebar + main side by side
          .sidebar          left panel; .sidebar-heading its caps label
          .tree             a file tree <ul>; <li> takes .dir .indent .indent-2
                            .active .added .modified
          .main             the main pane beside a sidebar
          .tabs .tab        editor tabs; .tab.active, .tab .dot (unsaved)
          .statusbar        bottom bar; .spacer pushes right, .bad .good colour
CODE      .code             code block (a <div>, never <pre>), 30px, numbered
          .code--lg         code at 34px
          .l                one code line (numbered); .l.here the line to look at
          .code--spotlight  on the BLOCK: dims every .l except .l.here
          .l.add .l.del     diff lines, green / red
          .l.bare           a line with no number (wrap, inline error)
          .squiggle         red wavy underline on the wrong thing
          .diagnostic       inline editor error text
TOKENS    .t-com .t-punc .t-key .t-storage .t-op .t-str .t-num .t-fn .t-type
          .t-class .t-prop .t-var .t-const .t-tag .t-attr   (vitesse-dark)
TERMINAL  .terminal         terminal body (never <pre>), 30px
          .cmd              a command line; "$ " is generated
          .out              an output line
          .blank            an empty line
          .ok .bad .warn .info .cyan .yellow .magenta .faint   word colours
          .caret            the block cursor (usable anywhere)
CLAUDE    .terminal.cc      a Claude Code session; each line one element:
 CODE     .you              a prompt the author typed ("> ", raised plate)
          .say              the agent's reply ("● ")
          .tool             a collapsed tool call ("● " green); name in <b>
          .result           its one-line result ("└ ")
          .spin             the working line ("✻ …"), amber
          .input .hint      the input box ("> ") and the line under it
          code              inline code in a reply, blue
BROWSER   .browserbar       the bar above a page; .nav-buttons, .urlbar
                            (.lock .host inside it)
          .page             the LIGHT page inside; styles h1 h2 p code,
                            .lede (bigger first paragraph), .signature (API box)
CARD      .card             Definition Card plate, amber bar on the left
          .kicker           small amber caps above the headline
          .headline         104px title; .rule the amber bar under it
          .subhead          the supporting line
DIAGRAM   .diagram          a centred row of nodes and arrows
          .node             a box; .node-title .node-sub inside;
                            .node.lit the one box, .node.muted pulled back
          .arrow            an arrow glyph; .label a hand-written word on it
          .annotation       a hand-written amber aside, tilted
SHARED    .caption          a strip along the bottom (a label, never the line)
          .spot             prose words to look at (the inline twin of .here)
          .overline         a small caps heading above a diagram or panes
          .split            two panes side by side, 2px rule between
          .logo             the inlined AI Hero mark
```

## Writing a frame

1. Copy the example **and `house.css`** into your scratch folder, side by side.
   The pages link `./house.css` relative to themselves.
2. Edit the markup. Keep `class="frame"` as the outermost element: it pins the
   page to exactly 1920x1080 and CUTS anything that does not fit, so overflow
   is something you can see rather than something you discover in playback.
3. Put **real** content on it. A frame of grey placeholder boxes cannot be
   judged for density, which is the whole reason the author is watching.
4. Capture it with `cvm clip-mockup capture <page.html>...`, then **look at
   the PNG at full size** before you add the Clip Mockup. A frame with
   unreadable type is found here or at minute 26 of the playback. For a run
   of pages, add `--sheet sheet.png` and read one contact sheet first.

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
