# PROTOTYPE — lucide → tldraw `PathBuilder` fidelity spike

Throwaway. Answers [mattpocock/personal-wiki#206](https://github.com/mattpocock/personal-wiki/issues/206),
part of the [Cmd+K diagram command palette map](https://github.com/mattpocock/personal-wiki/issues/204).

**Question:** can an arbitrary lucide icon be rendered faithfully as a custom tldraw
shape via `PathBuilder`, and what does the transpiler contract look like?

**Answer: yes.** All 1,611 icons transpile without a single throw, and 983 of them
are _pixel-identical_ to the source SVG at 96px. The residue is antialiasing-level.
The real findings are not about fidelity — they're about hit-testing and stroke width.

## Run it

```bash
pnpm prototype:lucide      # http://localhost:5311
```

Three tabs: `canvas` (a real tldraw editor with the shape), `compare` (source vs
transpiled, side by side, at seven sizes), `sweep` (pixel-diff every icon).

`window.runFidelitySweep()`, `window.runGeometrySweep()` (from
`src/geometry-sweep.ts`), `window.runHitTestSweep()`, `window.setHitMode()` and
`window.buildGallery()` are all callable from the console.

## Files

| file                        | what it is                                                     |
| --------------------------- | -------------------------------------------------------------- |
| `src/parse-path-d.ts`       | SVG `d` parser → absolute M/L/C/A/Z. Folds H/V/S/Q/T away.       |
| `src/lucide-to-path-builder.ts` | **The transpiler contract.** `IconNode` → `PathBuilder`.    |
| `src/icon-shape-util.tsx`   | The custom `IconShapeUtil`, with the two open design toggles.    |
| `src/fidelity-sweep.ts`     | Pixel diff, source SVG vs transpiled, same rasteriser.           |
| `src/geometry-sweep.ts`     | Resolution-independent Hausdorff error via `getPointAtLength`.   |
| `src/hit-test-sweep.ts`     | Real `editor.getShapeAtPoint` sweep at controlled zoom.          |
| `gen-icon-nodes.mjs`        | Build-time codegen: `lucide-react` `__iconNode` → one JSON.      |

## The transpiler contract

```ts
iconNodeToPathBuilder(node: IconNode, size: number): PathBuilder
```

- **24×24 → shape space** is a single uniform scale `size / 24`, applied to every
  coordinate as it is emitted. `PathBuilder` has no transform, so scaling has to
  happen during construction.
- `path` `d` → parsed to absolute M/L/C/A/Z. `H`/`V` → `L`. `S`/`T` →
  reflected control point. `Q`/`T` → cubic by exact degree elevation
  (`C1 = P0 + ⅔(Q−P0)`, `C2 = P2 + ⅔(Q−P2)`). No approximation anywhere.
- `circle`/`ellipse` → `moveTo` + two 180° `arcTo`s + `close` (the same shape
  tldraw's own geo ellipse uses).
- `rect` → rounded-rect path with four corner `arcTo`s. **`rx` and `ry` default to
  each other** — lucide relies on this and it is easy to miss (see below).
- `line`/`polyline` → `moveTo` + `lineTo`s, left open. `polygon` → same + `close`.
- `fill="currentColor"` (16 circles across 7 icons) → the subpath opens with
  `moveTo(x, y, { geometry: { isFilled: true } })`, and the shape renders a
  `toD({ onlyFilled: true })` pass underneath the stroke pass.

Three traps, all of which bite silently:

1. `cubicBezierTo(x, y, cp1x, cp1y, cp2x, cp2y)` takes **the endpoint first** —
   the inverse of SVG's `C`.
2. `arcTo(rx, ry, largeArcFlag, sweepFlag, xAxisRotationRadians, x, y)` takes
   flags as **booleans** and rotation in **radians**; SVG gives 0/1 and degrees.
3. `close()` clears the open subpath, so a path that continues after a `Z` must
   re-`moveTo` the subpath start or `PathBuilder` asserts.

## Measured results

### Fidelity — pixel diff, all 1,611 icons

Source SVG and transpiled path rendered through the same rasteriser in the same
24×24 viewBox, alpha channels diffed. Differences are therefore geometry, not
renderer.

| render size | pixel-identical | mean diff | icons >1% | icons >5% | throws |
| ----------: | --------------: | --------: | --------: | --------: | -----: |
|        48px |     911 / 1,611 |    0.458% |       184 |        24 |      0 |
|        96px |     983 / 1,611 |    0.195% |        83 |         4 |      0 |
|       384px |     719 / 1,611 |    0.152% |        43 |         0 |      0 |

Mean error _falls_ as resolution rises, and by 384px nothing differs by more than
2.7% — the signature of antialiasing rather than geometry error. The four worst at
96px — `loader-circle` (6.3%), `at-sign` (6.0%), `donut` (6.0%),
`clock-arrow-down` (5.1%) — are all large-arc icons, i.e. tldraw's `arcTo`
approximating each arc with up to four cubics.

### Fidelity — geometric, resolution-independent

Symmetric Hausdorff distance between densely sampled points on the source
elements and on the transpiled path, in 24-unit icon space (447-icon sample
including every Q/S/T, polygon, polyline, ellipse and filled-dot icon):

- median max error **0.015 units**, p95 **0.020** — both at the measurement floor
  (`SAMPLE_STEP / 2`). 0.02 units = **0.08% of the icon's width**.
- mean error p95 **0.0064 units**.
- 20 icons report a larger max error; every one is a **measurement artifact**, not
  a real error. They are icons made of many sub-0.05-unit dots (`dice-3`,
  `building`, `circle-ellipsis` …); uniform arc-length sampling of the combined
  path gives those dots ~0 samples. The pixel sweep confirms them identical
  (`dice-3`, `building`, `calculator`, `dices`, `shield-ellipsis`: **0** differing
  pixels at 384px).

### One real bug found (and fixed here)

`<rect ry="2">` with **no `rx`**. SVG's `auto` rule says the missing one takes the
other's value; a naive `rx ?? 0` produces square corners. `arrow-down-0-1`,
`arrow-up-0-1`, `arrow-down-1-0`, `arrow-up-1-0` were 7.1% wrong at 384px — the
worst resolution-independent error in the whole set — and dropped to 0.04% once
fixed. Any transpiler for this data needs a test for it.

### Hit-testing — the finding that actually matters

lucide icons are `fill: none`, so `PathBuilder.toGeometry()` produces a `Group2d`
of hollow subpaths. `getShapeAtPoint` (called exactly as the select tool calls it:
`margin = hitTestMargin / zoom`, `hitInside: false`) then only hits within ~8
screen px of an actual stroke. 120-icon sample, real editor:

| on-screen size | centre point selects | grid points selecting |
| -------------: | -------------------: | --------------------: |
|           48px |                91.7% |                 81.7% |
|           96px |            **66.7%** |                   54% |
|          200px |            **35.8%** |                 23.1% |
|          400px |            **32.5%** |                 11.3% |

**At 96px, a third of icons cannot be selected by clicking their middle.** At
200px, two thirds can't. It degrades with on-screen size because the 8px margin is
fixed in screen space while the empty gaps inside the glyph grow.

The fix is one line in `getGeometry`: return a `Group2d` whose **first** child is
an invisible filled `Rectangle2d` covering the shape's bounds (`getShapeAtPoint`
treats a group as filled when `children[0].isFilled`). Measured with that on:

| on-screen size | centre point selects | grid points selecting |
| -------------: | -------------------: | --------------------: |
|      48–400 px |             **100%** |              **100%** |

Cost: the icon becomes opaque to clicks over its whole bounding box — you can no
longer click "through" the empty part of an icon to a shape behind it. Toggle it
in the `canvas` tab (`hit:`) to feel the difference.

Note the hollow `geo` rectangle control also fails the same way (3.7% of grid
points at 400px) — it only appears to pass at the centre because geo shapes carry
a label geometry in the middle. Our icon shape has no label, so it has nothing to
fall back on.

### Stroke width — proportional wins, clearly

- **`proportional`** (`strokeWidth = 2 × size / 24`): the icon looks exactly like
  lucide at every size. A 400px icon gets a 33px stroke.
- **`tldraw`** (`DefaultSizeStyle`, s/m/l/xl = 2/3.5/5/10 flat): a 400px icon is a
  spindly hairline — `smile`'s eyes nearly vanish — and a 24px icon is a blob.

Screenshots of both are in the issue thread. Proportional is the only one that
looks like an icon. The consequence to decide: if stroke is proportional, the
`size` style prop does nothing to icons, so either drop it, or repurpose it to
mean the icon's **box size** on insert.

### `solid` vs `draw`

Both render. `draw` (tldraw's sketchy pass) stays legible and matches the tldraw
house style, but it distorts small interior features at large sizes — the `settings`
gear's inner circle becomes a lumpy polygon, `house` grows a stray overshoot at the
baseline. `solid` reproduces lucide exactly. This is a taste call, not a technical
one; the `canvas` tab's `dash:` selector flips it live.

### Other measurements

- **`getIndicatorPath`** — `PathBuilder.toPath2D({ style, strokeWidth: 1, … })`
  satisfies the 5.x surface directly; the selection outline traces the glyph. The
  deprecated `indicator()` is not needed.
- **Cost** — transpiling all 1,611 icons to `d` takes **17ms** total (0.01ms each);
  with `toGeometry()` as well, 48ms. No caching or memoisation needed; the icon
  _data_ still wants baking at build time, the transpile does not.
- **Mean emitted `d` length** — 295 characters.
- **`save-off`** is the only icon whose geometry falls outside the 24×24 viewBox
  (it reaches x = 33.6, 40% past the right edge). Its glyph will overflow the
  shape's bounds and selection box. Upstream data bug; either exclude it or clamp.
- **Aspect ratio must be locked.** 17 icons carry arcs with a non-zero x-axis
  rotation; a non-uniform scale would shear them, because `rx * sx, ry * sy` is
  only exact when `sx == sy` or the rotation is 0.
