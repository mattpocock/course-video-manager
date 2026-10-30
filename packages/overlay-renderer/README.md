# @cvm/overlay-renderer

A **standalone** package that renders CVM's overlays as a **transparent ProRes
4444 `.mov`**, using `@remotion/renderer` locally (Chromium). It renders **only
the overlay** — CVM composites it over the source video downstream with ffmpeg.

Two content-kinds share one composition, one props schema and one CLI:

| Content-kind        | Used by                           | Typical frame            |
| ------------------- | --------------------------------- | ------------------------ |
| Subtitles + CTA     | the vertical Shorts pipeline      | 1080×1920, whole video   |
| **Definition Card** | the landscape course-video export | 1920×1080, one card long |

A Definition Card is an AI-Hero-branded `title` + `description` pair. The
landscape pipeline renders **one card per `.mov`**, exactly as long as that
card's own duration — not a full-video-length track — so each card's render can
be cached independently.

Extracted from the deprecated `total-typescript-monorepo`
(`apps/remotion-subtitle-renderer`). It has **zero `@total-typescript/*`
imports**, its own manifest/deps, and **no AWS/Lambda** code path. The caption
look is kept pixel-identical to the original Remotion output.

## Contract: explicit props per invocation

There is no `meta.json`-in-the-source-tree handshake. Every render is driven by
explicit props (see [`src/props.ts`](./src/props.ts)):

```jsonc
{
  "width": 1080,
  "height": 1920,
  "fps": 60,
  "durationInFrames": 300,
  "subtitles": [
    {
      "startFrame": 0,
      "endFrame": 55,
      "text": "There's an idea floating around",
    },
  ],
  "cta": { "variant": "ai", "durationInFrames": 120 }, // or null
  "definitionCards": [
    {
      "title": "Ubiquitous Language",
      "description": "One shared vocabulary for a domain.",
      "startFrame": 0,
      "durationInFrames": 300,
    },
  ],
}
```

Only `durationInFrames` is required. `width`/`height`/`fps` default to the
vertical 1080×1920 60fps frame, and `subtitles`/`cta`/`definitionCards` all
default to empty — so a caller sends only the content-kind it wants, and the
Shorts pipeline's existing props keep parsing unchanged.

The CTA is rendered from one of the pre-made branded images in `public/`
(`ai` / `typescript`) so the look stays identical.

## Branding

Definition Cards use **DM Sans** (loaded through `@remotion/google-fonts`, the
same mechanism the subtitles use for Fira Code) and the **AI Hero mark** at
`public/ai-hero-logo.svg` — the path data copied verbatim from ai-hero's own
`favicon.svg` / `<LogoMark>`, pinned to white because an overlay has no page
behind it. It is a copy on purpose: this package must not reach into another
repo at build time.

## Use it

### Programmatically (from CVM)

```ts
import { renderOverlay } from "@cvm/overlay-renderer";

const { outputLocation } = await renderOverlay(props, {
  outputLocation: "/path/to/overlay.mov",
  onProgress: (p) => console.log(p),
});
```

### Shell-out (from anywhere)

This is how CVM actually drives it — as a subprocess, so the package stays out
of the application's toolchain:

```bash
# props from a file
node bin.mjs --props-file props.json --out overlay.mov

# props from stdin
cat props.json | node bin.mjs --out overlay.mov
```

`bin.mjs` prints the render result (dimensions, fps, frames, output path) as
JSON on stdout; progress goes to stderr.

## Chat Highlight card server

A second, long-lived entry point for the Live Stream. It renders the **Chat
Highlight** card (a Broadcast chat message shown on the stream picture) as a
transparent PNG still, once per click. It never renders per frame: the
recorder service's card feed eases the still.

```bash
node card-server.mjs [--frame-width 1920]
```

- It bundles once, opens one headless Chromium with **software GL**
  (`gl: "swangle"`, so it takes no GPU from NVENC or ddagrab), renders a
  warm-up card, then prints a `ready` line with the still's fixed canvas size.
- Each JSON line on stdin (`{"id","author","text"}`) gets one JSON line back on
  stdout: the PNG as base64, or an error. `--help` has the full protocol.
  stdout carries only the protocol; all logs go to stderr.
- It runs at the lowest CPU priority, set before Chromium launches.
- It has its own Remotion root (`remotion/card-server-index.ts`) holding only
  the card. The card loads **DM Sans from the bundled `@fontsource-variable`
  files**, not Google Fonts, so it renders with no network at all.
  `pnpm run studio:card` previews the card.
- The card reads the Definition Card's shared tokens
  (`src/definition-card-tokens.ts`). Its geometry and canvas size are in
  `src/chat-highlight-card.ts`.

## Develop

```bash
pnpm install      # installs Remotion + downloads Chromium on first render
pnpm run studio   # Remotion Studio preview
pnpm test         # props unit tests
pnpm run typecheck
```

There are deliberately **no tests against the render output** — see the Testing
section of `docs/TESTING_STANDARDS.md`. `pnpm run studio` is how a
branding change is checked.

## Transparency

`prores` + ProRes profile `4444` + pixel format `yuva444p10le` + `png` image
format give the overlay its alpha channel. These are set both in
`remotion.config.ts` (Studio/CLI) and directly in `src/render.ts` (programmatic
path). Don't change them without re-checking the ffmpeg composite downstream.

## Security

This package needs **no secrets and no `.env`**. The original monorepo renderer
carried committed AWS Lambda keys (`REMOTION_AWS_*`) for cloud rendering — those
were **not** copied here, and this package renders locally only.
