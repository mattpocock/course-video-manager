# lucide-icons

The vendored lucide icon set, plus the transpiler that turns one into tldraw
geometry. A deep module: see [../README.md](../README.md) for the entry-point
rules.

## Entry points

| file           | surface                                                                        |
| -------------- | ------------------------------------------------------------------------------ |
| `index.ts`     | **Data. tldraw-free.** `ICON_NAMES`, `getIconNode`, `searchIconNames`.         |
| `tldraw.ts`    | `iconNodeToPathBuilder`, `getIconPathBuilder`, `LUCIDE_VIEWBOX`, stroke width. |
| `generator.ts` | The generator's pure core, including the append-only invariant.                |

`index.ts` stays tldraw-free on purpose: `extract-scene-text` resolves icon
names on the server and must not pull tldraw into that bundle.

## Why the table is committed

A Diagram shape stores an icon **name**, not its geometry, so the icon set is
part of the persistence contract — and `CONTEXT.md` defines a DiagramSnapshot as
the state a Clip _"was filmed against"_. Lucide cannot be tracked: their release
workflow hard-codes `semver -i minor` for every automated release (76 versions
in 12 months), and inside 1.x alone 41 icons changed geometry under an unchanged
name at a median displacement of 1.02 units on a 24-unit grid. `fingerprint` was
renamed with no alias left behind. Pinning only defers the collision.

So the geometry is versioned by git history rather than by a dependency range,
and regeneration is **additive-only**: `appendIcons` copies the existing table
and only ever assigns keys that were absent from it. Removing an entry by hand
is permitted, and is the one change that can alter an already-filmed diagram.

Accepted cost: upstream improvements to icons we already carry are forgone, and
a rename leaves a near-duplicate in the picker (`fingerprint` +
`fingerprint-pattern`).

## Regenerating

```bash
pnpm gen:lucide-icons -- --lucide <version> [--only a,b,c] [--synonyms]
```

The baseline committed today was produced by three runs:

```bash
# 1. everything lucide 1.27.0 ships
pnpm gen:lucide-icons -- --lucide 1.27.0 --synonyms

# 2. the permanent removals — 18 brand marks plus `fingerprint`. Lucide's
#    BRAND_LOGOS_STATEMENT.md says the brands are not coming back, so vendoring
#    is the only way to keep them.
pnpm gen:lucide-icons -- --lucide 0.525.0 --synonyms \
  --only codepen,codesandbox,dribbble,facebook,figma,framer,fingerprint,github,\
gitlab,instagram,linkedin,pocket,rail-symbol,slack,trello,twitch,twitter,youtube

# 3. `chromium` — the 19th removal. It is NOT in 0.525.0, which still called it
#    `chrome`; lucide renamed it and then dropped it, so 1.0.0 is the last
#    release that carries it under its final name.
pnpm gen:lucide-icons -- --lucide 1.0.0 --only chromium --synonyms
```

`--synonyms` rewrites `lib/generated/synonyms.json` wholesale. That map is
**search-only** — it widens what a query matches (`grab` finds `hand-grab`) and
never rewrites a stored name — so it carries no persistence contract and is
regenerable independently of the frozen table.

## Data facts that bite silently

- **`rect` carries `rx` on 374 of 382 instances.** SVG's `auto` rule makes a
  missing `rx`/`ry` default to _the other_, not to 0 — `<rect ry="2">` with no
  `rx` is a rounded rect.
- **16 `circle`s across 7 icons carry `fill="currentColor"`** — filled dots and
  pupils, not outlines.
- **`save-off` has geometry entirely outside its viewBox** (`M29.5 11.5s5 5 4 5`,
  reaching x = 33.6). Never derive shape bounds from parsed geometry; normalise
  against the fixed 24×24 viewBox.

Brand-mark exposure is accepted and recorded: lucide removed them citing
"increasing legal pressures", and CVM's position differs materially — nominative
use of a logo to identify that product in educational material, versus
redistributing at scale as a general-purpose library.
