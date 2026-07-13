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
npm run lint:boundaries
```

It runs in the pre-commit hook alongside `typecheck`. Config lives in
`.dependency-cruiser.cjs` at the repo root; the only knob is `PACKAGES_ROOT`.
