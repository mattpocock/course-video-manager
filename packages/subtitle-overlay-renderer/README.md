# @cvm/subtitle-overlay-renderer

A **standalone** package that renders CVM's subtitle + CTA caption overlay as a
**transparent 1080×1920 ProRes 4444 `.mov`**, using `@remotion/renderer`
locally (Chromium). It renders **only the overlay** — CVM composites it over the
source video downstream with ffmpeg.

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
    { "startFrame": 0, "endFrame": 55, "text": "There's an idea floating around" }
  ],
  "cta": { "variant": "ai", "durationInFrames": 120 } // or null
}
```

`width`/`height`/`fps`/`cta` are optional (defaults: 1080×1920, 60fps, no CTA).
The CTA is rendered from one of the pre-made branded images in `public/`
(`ai` / `typescript`) so the look stays identical.

## Use it

### Programmatically (from CVM)

```ts
import { renderSubtitleOverlay } from "@cvm/subtitle-overlay-renderer";

const { outputLocation } = await renderSubtitleOverlay(props, {
  outputLocation: "/path/to/overlay.mov",
  onProgress: (p) => console.log(p),
});
```

### Shell-out (from anywhere)

```bash
# props from a file
node bin.mjs --props-file props.json --out overlay.mov

# props from stdin
cat props.json | node bin.mjs --out overlay.mov
```

`bin.mjs` prints the render result (dimensions, fps, frames, output path) as
JSON on stdout; progress goes to stderr.

## Develop

```bash
npm install      # installs Remotion + downloads Chromium on first render
npm run studio   # Remotion Studio preview
npm test         # props unit tests + a real render smoke test
npm run typecheck
```

## Transparency

`prores` + ProRes profile `4444` + pixel format `yuva444p10le` + `png` image
format give the overlay its alpha channel. These are set both in
`remotion.config.ts` (Studio/CLI) and directly in `src/render.ts` (programmatic
path). Don't change them without re-checking the ffmpeg composite downstream.

## Security

This package needs **no secrets and no `.env`**. The original monorepo renderer
carried committed AWS Lambda keys (`REMOTION_AWS_*`) for cloud rendering — those
were **not** copied here, and this package renders locally only.
