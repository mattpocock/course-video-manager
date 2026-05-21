# Collapse ClipSection into Chapter

The codebase originally maintained two names for the same concept: **ClipSection** (the authoring-time marker/divider in a video's timeline) and **Chapter** (the export-time projection that becomes a YouTube chapter). CONTEXT.md codified this split deliberately, with the ClipSection entry carrying `_Avoid_: Chapter (outside the export context)`.

## Why collapse

The split was not load-bearing. Every ClipSection mapped 1:1 to a YouTube chapter with no transformation, filtering, or aggregation in between. Carrying two names for the same thing created three concrete frictions:

1. **UI ambiguity.** The chapter-naming modal's label said "Section Name," colliding with the course **Section** concept (a directory of lessons). Anyone reading the editor had to disambiguate which kind of "Section" was meant.
2. **Cognitive overhead.** Developers reading the code had to mentally translate between ClipSection (types, DB, reducer actions) and Chapter (UI prose, warning rationale text, export context). The translation carried no information — it was pure overhead.
3. **Internal inconsistency.** The `missingOpeningSection` warning's own rationale said "Missing 0:00 chapter" — the prose already used "chapter" to explain code that said "section."

## Decision

Rename ClipSection → Chapter everywhere: domain glossary, database table and columns, TypeScript types, Drizzle schema exports, reducer action and effect types, discriminated-union tags, insertion-point types, React component filenames, the UI label, the Video Warning kind, and the API route URL. The database is renamed in-place via `ALTER TABLE RENAME` / `ALTER TABLE RENAME COLUMN` (not drizzle-kit drop+create) to preserve existing data.

## Consequences

- **Chapter** is now the single canonical name for the concept across code, database, UI, and documentation.
- The course **Section** entry in CONTEXT.md no longer needs an `_Avoid_: Chapter` line, since the naming collision that motivated it is gone.
- Migration files that reference the old `clip_section` table name remain as historical records of the pre-rename schema.
