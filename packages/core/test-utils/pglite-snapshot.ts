/**
 * The vitest context key the PGlite snapshot travels on.
 *
 * Its own module because both ends need the augmentation in scope — the global
 * setup that provides the path, and `createTestDb` in any workspace that
 * injects it — and a `declare module` only applies where it is part of the
 * program. Side-effect-imported from both.
 */
declare module "vitest" {
  export interface ProvidedContext {
    pgliteSnapshotPath: string;
  }
}

export {};
