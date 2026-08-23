# Packages — deep modules

Every package here is a **deep module**: a lot of behaviour behind a small
interface. A package's public surface is its **entry points** — the files at the
package root. Everything in a subfolder is private.

```
app/packages/
  <name>/
    index.ts     ← an entry point (public). Import THIS from outside.
    client.ts    ← another entry point. Expose SEVERAL small ones, not one barrel.
    lib/         ← implementation: hidden from outside, free to import each other.
    tests/       ← co-located tests + fixtures (a subfolder, so private).
```

**Import only through a package's entry points (its root files).** Never reach
into another package's `lib/` (or any subfolder). Copy `example/` as a starting
template (or delete it).

## The four rules (all errors)

1. **Entry-point boundary** — code outside a package may import only that
   package's root files, never anything in its subfolders.
2. **Intra-package freedom** — a package's own files import each other freely.
3. **Tests through the entry points** — files under `<pkg>/tests/` may import any
   package's entry points and their own `tests/` fixtures, but never any
   package's subfolder internals (not even their own).
4. **No cycles** — no dependency cycles.

## Don't use barrel files

The public surface is _every_ root file, so expose several small entry points
(`index.ts`, `client.ts`, `server.ts`) instead of funnelling everything through
one giant `index.ts` that re-exports a whole subtree. Adding an entry point is
just adding a root file — no barrel needed.

## Run the check

```
pnpm run lint:boundaries
```

It runs in the pre-commit hook alongside `typecheck`. From the repo root it
fans out through turbo to every workspace package's own `lint:boundaries`
script. The config for the packages described here lives in
`apps/local/.dependency-cruiser.cjs`; the only knob is `PACKAGES_ROOT`, which
points at `app/packages`.

## Deep modules that are also workspace packages

The rules above are about `apps/local/app/packages/` — packages that are plain
directories reached through the app's `@/*` tsconfig alias, with no
`package.json` of their own. Present members: `course-json`, `example`.

A deep module with consumers OUTSIDE `apps/local` cannot live here, because
nothing outside the app can resolve the `@/*` alias. It is promoted to a
top-level workspace package under `packages/` instead, and takes the same four
rules with it in its own `.dependency-cruiser.cjs` plus its own
`lint:boundaries` script — a promotion is a move, not an escape from the
boundary. `packages/lucide-icons` is the worked example: its entry points are
`index.ts`, `generator.ts` and `tldraw.ts`, which are exactly the three
`exports` in its `package.json`, and `lib/`/`tests/` stay private.
