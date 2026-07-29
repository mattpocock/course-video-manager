# Research: Sourcing lucide icon names + raw SVG geometry

Resolves [#205](https://github.com/mattpocock/personal-wiki/issues/205) (part of [#204](https://github.com/mattpocock/personal-wiki/issues/204)).

**Question:** the diagram window's Cmd+K icon picker needs, for every lucide icon, a _name_ (for fuzzy search) and its _raw SVG geometry_ (to transpile into tldraw `PathBuilder` calls). Which package exposes that, what shape is the data, and what does the geometry actually contain?

All numbers below were produced by enumerating installed packages with throwaway Node scripts, not estimated. Versions measured: `lucide-react@0.525.0` (installed in this repo), `lucide@0.525.0`, `lucide-static@0.525.0`, `lucide-static@1.27.0`, `@lucide/lab@0.1.2` (all fetched via `npm pack` and extracted). tldraw version in this repo: **5.2.4**.

---

## TL;DR

- **No new dependency is needed.** `lucide-react@0.525.0` already ships the raw geometry: every `dist/esm/icons/<name>.js` exports a named `__iconNode` — the `[tag, attrs][]` array. `dynamicIconImports.js` is a ready-made kebab-name → module map covering canonical names _and_ aliases.
- **1,611 canonical icons** in 0.525.0, plus **215 deprecated alias names** (1,826 addressable names total).
- Primitives used: `path` (5,261), `circle` (470), `rect` (382), `line` (218), `polyline` (19), `polygon` (13), `ellipse` (8). No `g`, no `text`. 56.6% of icons are pure-`path`; **699 icons need at least one non-path primitive converted**.
- **Yes, Q/S/T are used** — but only `Q`/`q`/`S`/`s` (never `T`/`t` in 0.525.0). **53 icons / 80 command occurrences.** All are losslessly convertible to cubics, so this is a bounded, exact transform, not an approximation.
- Full name + geometry payload: **332 KB raw / 67 KB gzipped / 55 KB brotli**. Names alone: 22 KB raw / 6.4 KB gzip.
- Bake at build time. The real risk isn't payload, it's **name stability**: between 0.525.0 and 1.27.0, 324 icons changed geometry, 199 were added, and **54 canonical names disappeared** — 36 survive as aliases, **18 were hard-removed** (all brand logos).

---

## 1. Which package exposes raw data

### `lucide-react@0.525.0` — already installed, already sufficient

Each icon module exports the geometry as a _named_ export alongside the component default:

`node_modules/lucide-react/dist/esm/icons/a-arrow-down.js`

```js
const __iconNode = [
  ["path", { d: "M3.5 13h6", key: "p1my2r" }],
  ["path", { d: "m2 16 4.5-9 4.5 9", key: "ndf0b3" }],
  ["path", { d: "M18 7v9", key: "pknjwm" }],
  ["path", { d: "m14 12 4 4 4-4", key: "buelq4" }],
];
const AArrowDown = createLucideIcon("a-arrow-down", __iconNode);
export { __iconNode, AArrowDown as default };
```

The type is declared in `dist/lucide-react.d.ts`:

```ts
type SVGElementType =
  | "circle"
  | "ellipse"
  | "g"
  | "line"
  | "path"
  | "polygon"
  | "polyline"
  | "rect";
type IconNode = [elementName: SVGElementType, attrs: Record<string, string>][];
```

The `key` attrs are React reconciliation keys and are dead weight for our purposes — stripping them cuts the bundle by 22% raw / 30% gzip (see §4).

`node_modules/lucide-react/dist/esm/dynamicIconImports.js` is a **1,826-entry kebab-case name → dynamic import map**, and it includes aliases pointing at canonical modules:

```js
"house": () => import('./icons/house.js'),
"home": () => import('./icons/house.js'),
```

This is the single best machine-readable alias table available in the installed tree — the import target path _is_ the canonical name.

### `lucide@0.525.0` (vanilla) — cleanest data, no React

Each icon module's **default export is the raw array** (no component wrapper):

`lucide/dist/esm/icons/house.js`

```js
const House = [
  ["path", { d: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" }],
  [
    "path",
    {
      d: "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    },
  ],
];
export { House as default };
```

Note: **no `key` attrs** here — the data is already minimal. `dist/esm/iconsAndAliases.js` re-exports all 1,611 icons under both canonical and alias PascalCase names.

### `lucide-static@0.525.0` — the purpose-built answer

Ships a single **`icon-nodes.json`** (644 KB on disk, pretty-printed) — a flat `Record<kebabName, IconNode>` with 1,611 entries and no `key` attrs. Byte-identical in content to lucide-react's `__iconNode` set with keys stripped (verified: re-serialised minified it is exactly 332.1 KB, matching the lucide-react-derived payload). Also ships `icons/*.svg` (1,611 files, 6.4 MB), `sprite.svg` (392 KB), a 15 MB icon font, and `tags.json`.

**Caveat:** `tags.json` in `lucide-static@0.525.0` is literally `{}` (2 bytes) — a packaging bug in that release. In `lucide-static@1.27.0` it is 240 KB with 1,756 entries. If search keywords beyond the icon name are wanted, 0.525.0 cannot supply them; they'd have to come from a newer `lucide-static` or from the repo's per-icon metadata JSON (see §6).

### `@lucide/lab@0.1.2` — optional extra set

Same shape (`icon-nodes.json`), **373 additional icons** ("nicely designed but with unknown use cases"). Separate namespace, separate versioning. Only worth including if the picker deliberately wants the long tail; it doubles the alias/rename surface for no core benefit.

### Recommendation

**Read from `lucide-react`'s `__iconNode` exports at build time.** It requires no new dependency, no version-skew risk between the picker data and any `lucide-react` components rendered elsewhere in the app, and it carries the alias map in `dynamicIconImports.js`. `lucide-static`'s `icon-nodes.json` is a marginally more convenient shape but adds a second dependency that must be kept version-locked to `lucide-react` by hand.

---

## 2. SVG primitive distribution (lucide 0.525.0, all 1,611 icons)

| element    | instances | icons containing |
| ---------- | --------: | ---------------: |
| `path`     |     5,261 |            1,529 |
| `circle`   |       470 |              337 |
| `rect`     |       382 |              312 |
| `line`     |       218 |              109 |
| `polyline` |        19 |               14 |
| `polygon`  |        13 |               11 |
| `ellipse`  |         8 |                7 |

`g` is permitted by the TypeScript type but **never used**. No `text`, no `use`, no nested SVG.

The rare primitives are enumerable in full:

- **polyline (14 icons):** `album`, `codepen`, `codesandbox`, `inbox`, `mailbox`, `package`, `package-check`, `package-minus`, `package-plus`, `package-search`, `package-x`, `rocking-chair`, `sword`, `swords`
- **polygon (11 icons):** `circle-play`, `codepen`, `fast-forward`, `navigation`, `navigation-2`, `play`, `rewind`, `skip-back`, `skip-forward`, `step-back`, `step-forward`
- **ellipse (7 icons):** `cone`, `cylinder`, `database`, `database-backup`, `database-zap`, `drum`, `torus`

Attribute vocabulary per element (exhaustive — nothing else appears anywhere in the set):

```
path:     d (5261), key (5261)
circle:   cx, cy, r (470 each), key, fill (16)
rect:     x, y, width, height (382 each), rx (374), ry (44), key
line:     x1, x2, y1, y2 (218 each), key
polyline: points (19), key
polygon:  points (13), key
ellipse:  cx, cy, rx, ry (8 each), key
```

Two things worth calling out:

- **`fill="currentColor"` appears on 16 `circle` elements** across 7 icons: `chart-scatter` (×5), `key-round`, `palette` (×4), `tag`, `tags`, `vault` (×4). These are filled dots, not outlines. A converter that assumes everything is stroked-and-unfilled will render these as hollow rings. tldraw's `PathBuilder` supports per-subpath fill via `PathBuilderLineOpts.geometry` on `moveTo`, and `toD({ onlyFilled: true })` for the filled pass, so this is expressible — but it must be handled explicitly.
- **`rect` has `rx` on 374 of 382 instances** — rounded rects are the norm, so the rect→path conversion needs the corner-arc path, not just four lines. 43 icons additionally set `ry` distinct from `rx`.

**Icons requiring at least one non-`path` primitive: 699 of 1,611 (43.4%).** Pure-`path` icons: 912 (56.6%).

---

## 3. Path command distribution — and the Q/S/T answer

Across all 5,261 `<path>` elements:

| cmd | occurrences | icons |     | cmd | occurrences | icons |
| --- | ----------: | ----: | --- | --- | ----------: | ----: |
| `M` |       4,269 | 1,460 |     | `L` |         340 |   239 |
| `a` |       3,633 | 1,031 |     | `z` |         247 |   222 |
| `h` |       2,059 |   995 |     | `Z` |         234 |   205 |
| `v` |       1,941 |   939 |     | `C` |         109 |    80 |
| `m` |       1,056 |   635 |     | `s` |          64 |    44 |
| `H` |         848 |   613 |     | `S` |          11 |     9 |
| `l` |         831 |   433 |     | `q` |           4 |     4 |
| `V` |         779 |   624 |     | `Q` |           1 |     1 |
| `c` |         589 |   264 |     |     |             |       |
| `A` |         462 |   319 |     |     |             |       |

Totals: arcs 4,095 occurrences across 1,883 path elements; cubics 698; **quadratics + smooth-shorthand 80**.

### Do any lucide icons use Q, S or T?

**Yes — 53 icons, 80 command occurrences. `T`/`t` are never used in 0.525.0.**

- `Q` (1 icon): `paw-print`
- `q` (4 icons): `flag`, `flag-off`, `hamburger`, `vegan`
- `S` (9 icons): `beer`, `carrot`, `droplets`, `heading-5`, `pocket-knife`, `subscript`, `superscript`, `tangent`, `tree-palm`
- `s` (44 icons): `angry`, `baby`, `beer`, `beer-off`, `bus`, `cake`, `car`, `carrot`, `cat`, `dog`, `drama`, `droplet`, `droplets`, `egg-fried`, `fish`, `fish-symbol`, `frown`, `lasso`, `lasso-select`, `line-squiggle`, `list-ordered`, `message-circle-dashed`, `panda`, `parentheses`, `plane-landing`, `pocket-knife`, `rocket`, `roller-coaster`, `rotate-3d`, `save-off`, `scale`, `scan-face`, `ship`, `shovel`, `smile`, `smile-plus`, `soap-dispenser-droplet`, `spell-check-2`, `squircle`, `sticker`, `tangent`, `theater`, `twitter`, `variable`

Full de-duplicated list (53): `angry`, `baby`, `beer`, `beer-off`, `bus`, `cake`, `car`, `carrot`, `cat`, `dog`, `drama`, `droplet`, `droplets`, `egg-fried`, `fish`, `fish-symbol`, `flag`, `flag-off`, `frown`, `hamburger`, `heading-5`, `lasso`, `lasso-select`, `line-squiggle`, `list-ordered`, `message-circle-dashed`, `panda`, `parentheses`, `paw-print`, `plane-landing`, `pocket-knife`, `rocket`, `roller-coaster`, `rotate-3d`, `save-off`, `scale`, `scan-face`, `ship`, `shovel`, `smile`, `smile-plus`, `soap-dispenser-droplet`, `spell-check-2`, `squircle`, `sticker`, `subscript`, `superscript`, `tangent`, `theater`, `tree-palm`, `twitter`, `variable`, `vegan`

Concrete examples:

```
smile        M8 14s1.5 2 4 2 4-2 4-2          (s — the smile itself)
paw-print    M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z
vegan        M16 8q6 0 6-6-6 0-6 6
squircle     M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9-9-1.8-9-9 1.8-9 9-9
```

### This is not a fidelity problem

`PathBuilder` (`node_modules/tldraw/src/lib/shapes/shared/PathBuilder.tsx`) offers `moveTo`, `lineTo`, `cubicBezierTo`, `arcTo`, `circularArcTo`, `close`. There is no quadratic. But every one of these conversions is **algebraically exact**, not an approximation:

- **Q → C**: given start `P0`, quadratic control `Q1`, end `P2`, the equivalent cubic controls are `C1 = P0 + 2/3·(Q1 − P0)` and `C2 = P2 + 2/3·(Q1 − P2)`. Exact, degree elevation.
- **S** is pure shorthand for `C` with the first control point being the reflection of the previous cubic's second control about the current point (or the current point itself if the previous command wasn't a cubic).
- **T** is the same shorthand for `Q`; unused in 0.525.0 but present in 1.27.0 (7 `t` occurrences), so a converter should handle it anyway.

So a full SVG-path → `PathBuilder` transpiler covers 100% of the icon set with zero geometric loss. The only genuinely lossy step is elsewhere: `arcTo` internally approximates each arc with up to four cubic Béziers (one per 90° segment) — documented in the source as deliberate, because arc flags are hypersensitive to the offsets tldraw applies in draw-style rendering.

### Parser notes

- **Arc flags are always whitespace-separated** in lucide's data. Checked all 1,883 arc-bearing paths for SVGO's "glued flag" compaction (e.g. `a5 5 0 015 5`): **zero occurrences**. A naive number-splitting parser is safe here — but only for _this_ data, so it's worth asserting rather than assuming across version bumps.
- `PathBuilder.cubicBezierTo(x, y, cp1X, cp1Y, cp2X, cp2Y)` takes **the endpoint first**, the inverse of SVG's `C cp1x cp1y cp2x cp2y x y`. Easy source of silently-wrong curves.
- `PathBuilder.arcTo(rx, ry, largeArcFlag, sweepFlag, xAxisRotationRadians, x2, y2)` takes flags as **booleans** and rotation in **radians** — SVG gives `0`/`1` and degrees.
- `PathBuilder` requires a `moveTo` before anything else (`assert(this.lastMoveTo, 'Start an SVGPathBuilder with .moveTo()')`), so each subpath must be opened explicitly. `close()` sets an `isClose` flag on the last command rather than emitting a separate segment, and clears `lastMoveTo` — a following command must re-`moveTo`.

### One upstream data quirk

`save-off` contains `M29.5 11.5s5 5 4 5` — geometry spanning x ≈ 29.5–38.5, entirely **outside the `0 0 24 24` viewBox**. Present identically in both 0.525.0 and 1.27.0, so it's a long-standing upstream artefact, not a fluke. Implication: **do not derive the shape's bounds from the parsed geometry**. Always normalise against the fixed 24×24 viewBox, or `save-off` (and any future icon with stray geometry) will scale to a fraction of its neighbours.

---

## 4. Counts and payload

**1,611 canonical icons** (0.525.0). 1,826 addressable names including the 215 deprecated aliases.

Measured with `zlib.gzipSync(level: 9)` and `zlib.brotliCompressSync` over the minified JSON:

| payload                                       |      raw |    gzip |  brotli |
| --------------------------------------------- | -------: | ------: | ------: |
| names only (JSON array of 1,611 strings)      |  21.9 KB |  6.4 KB |  5.7 KB |
| names + geometry, `key` attrs stripped        | 332.1 KB | 67.2 KB | 55.0 KB |
| names + geometry, including React `key` attrs | 425.3 KB | 96.1 KB | 79.1 KB |

Average geometry: **211 bytes/icon raw**. Elements per icon: min 1, median 3, max 15 (`brain-cog`).

Stripping the `key` attrs is free and saves 93 KB raw / 29 KB gzip — worth doing in the codegen step.

For comparison, `lucide-static@1.27.0`'s larger set (1,756 icons) is 381 KB raw / 76.1 KB gzip.

**67 KB gzipped for the whole set is not obviously prohibitive**, but it's also not nothing for a feature reachable only via Cmd+K. Two cheap options if it matters: ship the 6.4 KB name list eagerly for search and lazy-chunk the geometry on first insert; or ship only geometry for icons actually present in the scene plus a lazily-loaded picker chunk. Given the diagram window is a desktop Electron surface rather than a cold-start web page, bundling all 67 KB up front is likely fine and much simpler.

---

## 5. viewBox and stroke conventions

From `node_modules/lucide-react/dist/esm/defaultAttributes.js` — identical to the header of every `lucide-static` SVG file:

```js
{
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
}
```

Every icon in the set shares this — there is no per-icon viewBox or stroke override anywhere in `icon-nodes.json`. The only per-element paint override in the whole library is the 16 `fill="currentColor"` circles noted in §2.

Consequences for the ShapeUtil:

- The **2px stroke is in a 24-unit coordinate space**, i.e. 1/12 of the icon's extent. When the shape is scaled, stroke width must scale proportionally or the icon will look wrong at both ends of the size range. `lucide-react`'s own `absoluteStrokeWidth` option exists precisely to opt _out_ of this (`strokeWidth * 24 / size`); we want the default proportional behaviour.
- `stroke-linecap`/`linejoin` **`round`** are load-bearing for lucide's visual identity — flat caps on a 2px stroke read as a different icon set.
- `fill: none` means the geometry is open outlines. Closed subpaths (`Z`, 234 + 247 occurrences) still must not be filled.
- The requirement to render with a **white stroke via `DefaultColorStyle`** rather than `currentColor` is straightforward: `currentColor` never appears in the `d`/geometry data, only in the default attributes and the 16 fills. The ShapeUtil resolves colour itself from the style prop (`DefaultColorStyle` is exported from `@tldraw/tlschema` and re-exported by `tldraw`, paired with `getDefaultColorTheme`) and never reads lucide's default attribute block at all. The 16 `fill="currentColor"` circles need the same resolved colour applied as a fill.

---

## 6. Build-time codegen vs runtime resolution

### Recommendation: bake at build time

A codegen script reads `lucide-react`'s `__iconNode` exports, strips `key`, converts every primitive and path command into `PathBuilder` call data, and emits a single generated module.

Arguments for:

- **The conversion is pure and total.** Nothing about the transform depends on runtime state — 1,611 icons, a fixed viewBox, a closed vocabulary of 7 elements and 16 path commands, all verified above. There is no reason to pay for it on every app start.
- **Failures surface at build, not at paint.** Every one of the sharp edges found here — Q/S/T elevation, `rx`/`ry` rounded rects, the 16 filled circles, `save-off`'s out-of-viewBox path — becomes a build-time assertion. A runtime converter turns each of them into a silently misrendered shape in someone's diagram.
- **Free version diffing.** With the geometry checked in, a `lucide-react` bump produces a reviewable diff. Right now that would have shown 324 changed icons and 54 vanished names between 0.525.0 and 1.27.0 (§ below) — invisible under runtime resolution.
- **No parser in the shipped bundle.** An SVG path tokenizer plus arc/quadratic conversion is a few KB and, more importantly, a correctness liability living in production.

Arguments against, and why they're weak here:

- _Bundle size._ Baked `PathBuilder` command arrays are somewhat larger than the raw `d` strings (numbers as JSON vs. a compact string grammar). Mitigation: emit the raw `d` strings and primitives in a normalised form and keep the parser, _or_ emit compact command tuples. Either way we're in the same order of magnitude as the 67 KB gzip measured in §4 — and the codegen approach can additionally tree-shake to only-used icons if the picker is ever narrowed to a curated subset.
- _Staleness._ Regenerating is a script + a lockfile bump; it's a chore, not a risk, and the diff is the point.

### The version-pinning implication is the real finding

Scene documents store only the icon **name**. That name is a foreign key into whatever lucide version the _build_ carries. Empirically, that key is **not stable**.

Comparing `lucide-static@0.525.0` (1,611 icons) to `lucide-static@1.27.0` (1,756 icons):

- **199 icons added**
- **324 icons changed geometry** while keeping their name (`a-arrow-down`, `anchor`, `apple`, `arrow-big-down`, …). A saved scene renders _differently_ under a newer build, silently. Usually a redesign nobody minds; occasionally not.
- **54 canonical names no longer exist**, split into two very different cases:

  **36 renamed — recoverable.** The old name survives as a deprecated alias resolving to the new canonical icon: `align-center`, `align-justify`, `align-left`, `align-right`, `file-audio`, `file-audio-2`, `file-badge-2`, `file-check-2`, `file-code-2`, `file-json`, `file-json-2`, `file-key-2`, `file-lock-2`, `file-minus-2`, `file-plus-2`, `file-search-2`, `file-type-2`, `file-video`, `file-video-2`, `file-volume-2`, `file-warning`, `file-x-2`, `fingerprint`, `flip-horizontal`, `flip-vertical`, `grab`, `history`, `indent-decrease`, `indent-increase`, `letter-text`, `location-edit`, `podcast`, `text`, `text-select`, `waves`, `wrap-text`.

  **18 hard-removed — unrecoverable.** All brand logos, deleted in Lucide v1: `chrome`, `codepen`, `codesandbox`, `dribbble`, `facebook`, `figma`, `framer`, `github`, `gitlab`, `instagram`, `linkedin`, `pocket`, `rail-symbol`, `slack`, `trello`, `twitch`, `twitter`, `youtube`. The [v1 release notes](https://github.com/lucide-icons/lucide/releases/tag/1.0.1) state _"Removed brand icons, see our brand logo statement for more details"_, and the [migration guide](https://lucide.dev/guide/version-1) confirms all brand icons were removed for legal/trademark reasons, pointing users at Simple Icons instead.

### Does lucide maintain aliases?

**Yes, formally.** Aliases are first-class in the upstream per-icon metadata. From `icons/house.json` in the lucide repo:

```json
"aliases": [
  { "name": "home", "deprecationReason": "alias.name", "deprecated": true }
]
```

And `icon.schema.json` defines the full contract, including an explicit removal-scheduling field:

```json
"deprecated": { "const": true },
"deprecationReason": { "$ref": "#/$defs/aliasDeprecationReasons" },
"toBeRemovedInVersion": {
  "$ref": "#/$defs/versionNumber",
  "description": "The version this icon will be removed in."
}
```

So renames are handled gracefully and telegraphed. But `toBeRemovedInVersion` exists because aliases _do_ eventually get dropped, and the brand-icon deletion shows lucide will remove icons outright for non-naming reasons. Alias coverage in the packages themselves varies: `lucide-static@0.525.0` ships **no** alias SVGs (1,611 files = exactly the canonical count), while `lucide-static@1.27.0` ships **251** alias SVGs (2,007 files vs 1,756 canonical). `lucide-react` ships aliases as re-export stub modules in both:

```js
// dist/esm/icons/home.js
export { default } from "./house.js";
```

### What this means for the shape

Storing the bare name is fine, but the ShapeUtil needs a defined behaviour for "name not found in this build". Options, roughly in increasing cost:

1. **Render a placeholder** (e.g. `circle-help`) and keep the unknown name in props so the shape survives a round-trip and starts working again if the icon returns. Cheap, non-destructive, and the strictly minimum viable answer.
2. **Ship an alias→canonical resolution table** in the generated module, derived from `dynamicIconImports.js` (215 alias entries in 0.525.0, ~2 KB gzipped). Resolves at _insert_ time and again at _load_ time, so scenes authored under an older build keep rendering after a bump. Covers the 36-of-54 rename case entirely.
3. **Store the geometry in the shape props**, not just the name. Fully self-describing scenes, immune to every version issue above — at the cost of ~200 bytes per shape and losing the ability to fix or restyle an icon by bumping the dep. Explicitly out of scope per #204, and correctly so, but worth noting as the only option that makes a scene truly portable.

(1) + (2) together are cheap and cover everything except the 18 deleted brand icons, which cannot be recovered by any name-based scheme and would need geometry-in-props or a vendored copy. Given brand logos are a plausible thing to want in an architecture diagram, it may be worth deciding _now_ whether to pin `lucide-react` below 1.0 or vendor the handful of brand marks separately.

---

## Sources

Read directly from disk:

- `node_modules/lucide-react/dist/esm/icons/*.js` (1,826 modules), `defaultAttributes.js`, `Icon.js`, `createLucideIcon.js`, `dynamicIconImports.js`, `dist/lucide-react.d.ts` — v0.525.0
- `node_modules/tldraw/src/lib/shapes/shared/PathBuilder.tsx` — tldraw v5.2.4
- `lucide@0.525.0`, `lucide-static@0.525.0`, `lucide-static@1.27.0`, `@lucide/lab@0.1.2` — obtained via `npm pack`, inspected as extracted tarballs

Upstream primary sources:

- <https://raw.githubusercontent.com/lucide-icons/lucide/main/icon.schema.json> — alias/deprecation schema
- <https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/house.json> — example alias metadata
- <https://github.com/lucide-icons/lucide/releases/tag/1.0.1> — Lucide V1 release notes
- <https://lucide.dev/guide/version-1> — V1 migration guide
- <https://lucide.dev/brand-logo-statement> — brand logo removal rationale
