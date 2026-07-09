# Extracting searchable plaintext from a tldraw 5 scene

Research asset for [personal-wiki#130](https://github.com/mattpocock/personal-wiki/issues/130)
(map: [#129 CVM diagram content search](https://github.com/mattpocock/personal-wiki/issues/129)).

**Question:** given a tldraw 5 scene stored as jsonb (`diagram.head_scene`,
`diagram_snapshot.scene`), which shapes/props hold user-authored text, and what is
the contract for a `richText → plaintext` flattener that the tsvector-column ticket
(#133) and the backfill ticket (#134) can both depend on?

All facts below are read from the installed source at
`node_modules/tldraw@5.0.0` and `node_modules/@tldraw/tlschema` (and TipTap), cited
by file path.

---

## 1. The scene shape

A scene persisted by tldraw is a store snapshot: `{ store, schema }`, where `store`
is a flat record map keyed by record id. Records we care about are shapes:

```jsonc
store["shape:abc"] = {
  "id": "shape:abc",
  "typeName": "shape",     // the discriminant we filter on
  "type": "text",          // shape subtype: text | geo | note | arrow | frame | …
  "props": { /* subtype-specific; text lives here */ },
  "parentId": "…", "index": "…", "x": 0, "y": 0, "rotation": 0,
  "opacity": 1, "isLocked": false, "meta": {}
}
```

Extraction is: iterate `store` values → keep records where `typeName === "shape"` →
pull the text-bearing props for that `type`.

> Source: record shape is `TLBaseShape` in
> `@tldraw/tlschema/dist-cjs/index.d.ts`; the default shape type list is
> `['arrow','bookmark','draw','embed','frame','geo','group','image','line','note','text','video','highlight']`
> (ibid., ~line 4248).

---

## 2. The rich-text model (`TLRichText`)

Since the `AddRichText` migration, tldraw stores shape text as **ProseMirror /
TipTap document JSON**, not a flat string.

```ts
// @tldraw/tlschema/dist-cjs/index.d.ts
export declare type TLRichText = T.TypeOf<typeof richTextValidator>;
// richTextValidator: { type: string; content: unknown[]; attrs?: any }
```

Canonical shape (ibid., docstring on `richTextValidator` / `TLRichText`):

```jsonc
{
  "type": "doc",
  "content": [
    { "type": "paragraph",
      "content": [ { "type": "text", "text": "Hello world!" } ] }
  ]
}
```

Facts that drive the flattener:

- The document root is `{ type: "doc", content: [...] }`.
- **Block nodes** (`paragraph`, `heading`, `listItem`, `bulletList`, `orderedList`,
  `blockquote`, `codeBlock`, …) nest via their own `content` array.
- **Leaf text** lives only in nodes where `node.type === "text"`, as `node.text`
  (a plain string). Formatting is carried by `node.marks` (bold, italic, code,
  highlight, link) — marks do **not** split the text, so `Hello **world**` is two
  text nodes `"Hello "` + `"world"` inside one paragraph, and must concatenate to
  `"Hello world"` (no separator) so phrase search still matches.
- `toRichText("Hello\nWorld")` produces **one paragraph per line**
  (ibid., `toRichText` docstring) — i.e. newlines become block boundaries, not
  in-node `\n`.

### 2a. tldraw's own plaintext renderer (reference, not reusable server-side)

```js
// tldraw/dist-cjs/lib/utils/text/richText.js
function renderPlaintextFromRichText(editor, richText) {
  if (isEmptyRichText(richText)) return "";
  return plainTextFromRichTextCache.get(richText, () => {
    const tipTapExtensions =
      editor.getTextOptions().tipTapConfig?.extensions ?? tipTapDefaultExtensions;
    return generateText(richText, tipTapExtensions, { blockSeparator: "\n" });
  });
}
function isEmptyRichText(richText) {
  if (richText.content.length === 1) {
    if (!richText.content[0].content) return true;   // single empty block ⇒ ""
  }
  return false;
}
```

Two things to copy, one to reject:

- **Copy the semantics.** `generateText(doc, exts, { blockSeparator: "\n" })` is
  ProseMirror `textBetween`: concatenate `text` nodes with **no** separator, and
  insert the block separator (`"\n"`) at **block boundaries**. Our flattener should
  reproduce exactly this — text nodes glued, blocks joined by whitespace.
- **Copy the empty guard.** A "blank" richText is `{type:"doc",content:[{type:"paragraph"}]}`
  (single block, no inner `content`) → yields `""`. Skip it.
- **Reject the dependency.** `renderPlaintextFromRichText` needs a live `Editor`
  instance and the full TipTap extension set — a browser/editor concern. The
  backfill (#134) and the write-time trigger run **server-side over raw jsonb**, so
  we must **not** instantiate a tldraw editor. The flattener is a standalone tree
  walk; it does not import from `tldraw`.

---

## 3. Which shapes/props carry user text

Enumerated from the `*ShapeProps` interfaces in
`@tldraw/tlschema/dist-cjs/index.d.ts`.

### richText (ProseMirror JSON) — the primary source

| shape `type` | prop         | what it is                    |
| ------------ | ------------ | ----------------------------- |
| `text`       | `props.richText` | the text shape's body     |
| `geo`        | `props.richText` | label inside a geo (rect, ellipse, …) |
| `note`       | `props.richText` | sticky-note body          |
| `arrow`      | `props.richText` | arrow's mid-line label    |

> `TLTextShapeProps.richText`, `TLGeoShapeProps.richText`, `TLNoteShapeProps.richText`,
> `TLArrowShapeProps.richText` — all typed `TLRichText` (ibid., lines ~3302, 4709,
> 5502, 6195). These four are the whole of the rich-text surface.

### Flat string props — secondary, user-authored

| shape `type`   | prop            | include? | why                                             |
| -------------- | --------------- | -------- | ----------------------------------------------- |
| `frame`        | `props.name`    | **yes**  | user-typed frame label (`TLFrameShapeProps.name: string`) |
| `image`        | `props.altText` | optional | user alt text (`TLImageShapeProps.altText: string`) |
| `video`        | `props.altText` | optional | user alt text (`TLVideoShapeProps.altText: string`) |
| `bookmark`     | `props.url`     | **no**   | it's a URL — exactly the false-positive class the map rejects |

Shapes with **no** user text (skip entirely): `draw`, `highlight`, `line`, `group`,
`embed` (has `url`, not text), plus `bookmark` per above.

**Recommendation for the spec:** index `richText` from `text/geo/note/arrow` **plus
`frame.props.name`**. Treat `image`/`video` `altText` as an easy opt-in (same "flat
string" path as frame name) — cheap to include, low false-positive risk — but leave
it a #133 decision. Do **not** index `bookmark.url` / `embed.url`.

### 3a. Legacy flat `props.text` (defensive)

The `AddRichText` migration body is literally:

```js
// @tldraw/tlschema/dist-cjs/shapes/TLTextShape.js  (same for geo/note/arrow)
props.richText = toRichText(props.text);
delete props.text;
```

So a **migrated** store never has a flat `props.text` on text/geo/note/arrow — it's
`richText`. But the DB holds **raw jsonb** exactly as it was written; a scene
persisted by an older tldraw build (before this migration ran) could still carry
`props.text` and no `richText`. The flattener must therefore be defensive per shape:

1. if `props.richText` present → flatten it;
2. else if `props.text` (string) present → use it verbatim;
3. else nothing.

(#133/#134 can decide whether to also run `schema.migrateStoreSnapshot` before
extraction; the fallback above makes the flattener correct even if they don't.)

---

## 4. Flattener contract

A pure, dependency-free function. No tldraw import, no editor, deterministic.

```ts
/**
 * Extract all user-authored plaintext from a tldraw scene snapshot.
 * Input:  the persisted scene object ({ store, schema, ... }) OR a bare store map.
 * Output: a single whitespace-joined string (order = store iteration order),
 *         "" when the scene has no text. Never throws on malformed input.
 */
export function extractSceneText(scene: unknown): string;

/** Flatten one TLRichText (ProseMirror doc) to plaintext. Exported for reuse/tests. */
export function flattenRichText(richText: unknown): string;
```

### `flattenRichText` rules (mirrors `generateText` w/ `blockSeparator`)

- Walk the node tree depth-first from the root's `content`.
- At a node with `type === "text"` and string `text`: **append `node.text`**
  with no surrounding separator (glues marked runs into phrases).
- At a **block-level** node boundary: emit a separator between blocks. A single
  space (`" "`) is sufficient and safest for tsvector (word boundary; avoids gluing
  the last word of one paragraph to the first of the next). `"\n"` also works — for
  `to_tsvector` the choice is cosmetic since Postgres tokenizes on whitespace.
- Ignore marks, attrs, and non-text leaf nodes (`hardBreak`, `image`, etc.).
- Empty-doc guard: `content.length === 1 && !content[0].content` → `""`.
- Collapse runs of whitespace and `.trim()` the result.

### `extractSceneText` rules

- Accept the full persisted object and read `scene.store` (fall back to treating the
  argument itself as the store map if `.store` is absent) — be liberal in input.
- For each value where `typeName === "shape"`:
  - `richText` present → `flattenRichText(props.richText)`;
  - else `props.text` (string) → use it (legacy fallback, §3a);
  - `frame` → also/instead take `props.name`;
  - (optional, per #133) `image`/`video` → `props.altText`.
- Join all shape fragments with a single space; collapse whitespace; `.trim()`.
- Total tolerance: unknown shape types, missing `props`, non-doc richText, `null`
  fields all yield `""` for that shape, never a throw. Backfill runs over the whole
  table and must not die on one weird row.

### Downstream contract (why the shape is this)

- **#133 (tsvector column):** feeds this one string into `to_tsvector('english', …)`
  (a generated/trigger column on the scene, or a per-diagram aggregate over its
  snapshot history). One `text → string` function, one call site.
- **#134 (backfill):** maps `extractSceneText` over every existing
  `diagram.head_scene` and `diagram_snapshot.scene`. Because it's pure and
  tldraw-free, it runs in a plain Node migration script with no browser/editor
  bootstrapping.

---

## 5. Answers to the ticket, in one line each

- **Shape types with user text:** `text`, `geo`, `note`, `arrow` (all via
  `props.richText`), plus flat `frame.props.name`; optional `image`/`video`
  `props.altText`. Everything else (`draw`, `line`, `highlight`, `group`,
  `embed`, `bookmark`) has none worth indexing.
- **Prop that holds it:** `props.richText` (ProseMirror doc) primarily; legacy
  `props.text` as a defensive fallback; `props.name`/`props.altText` are plain
  strings.
- **Flattener:** walk `store` → `typeName==="shape"` → per shape, flatten
  `richText` by concatenating `{type:"text"}` leaves and joining blocks with
  whitespace (matching tldraw's own `generateText({blockSeparator})`), with the
  empty-doc guard; add flat-string props; join shapes with spaces; total-tolerant;
  pure and tldraw-free.
- **Contract:** `extractSceneText(scene) => string` (+ exported
  `flattenRichText(richText) => string`), the single dependency for #133 and #134.

---

## Sources

- `node_modules/tldraw@5.0.0/dist-cjs/lib/utils/text/richText.js` —
  `renderPlaintextFromRichText`, `isEmptyRichText`, `generateText({blockSeparator})`.
- `node_modules/@tldraw/tlschema/dist-cjs/index.d.ts` — `TLRichText`,
  `richTextValidator`, `toRichText`, and the `*ShapeProps` interfaces
  (`TLText/Geo/Note/Arrow/Frame/Image/Video/BookmarkShapeProps`).
- `node_modules/@tldraw/tlschema/dist-cjs/shapes/TLTextShape.js` — `AddRichText`
  migration (`props.richText = toRichText(props.text); delete props.text`).
- TipTap `@tiptap/core` `generateText` (ProseMirror `Fragment.textBetween`) — block
  separator semantics.
