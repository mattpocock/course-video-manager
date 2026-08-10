import { Context, Layer } from "effect";

/**
 * The port the Diagram operations write thumbnails through.
 *
 * A DiagramSnapshot's PNG is the one part of a Diagram that does not live in
 * the database: the row records the content hash, and the bytes sit on disk.
 * That put the only piece of filesystem access inside the domain operations,
 * which is exactly what `packages/core` may not have — the deployed API has no
 * disk to write to.
 *
 * So the operations ask for this service and the caller decides what backs it.
 * The local application provides the on-disk store; anything without a disk
 * provides {@link DiagramThumbnailStore.noop}, and the row is still written.
 * Writes are synchronous and total by design: a thumbnail is a cache of
 * something the scene can always be re-rendered into, so a failure to store one
 * must never fail the Diagram write that produced it.
 */
export interface DiagramThumbnailStoreApi {
  /** Store the PNG for a preserved DiagramSnapshot, keyed by content hash. */
  readonly writeDiagramThumbnail: (
    diagramId: string,
    contentHash: string,
    png: Buffer
  ) => void;
  /** Store the PNG for a Component, keyed by component id. */
  readonly writeComponentThumbnail: (componentId: string, png: Buffer) => void;
  /** Best-effort delete of a Component's PNG. Missing is success. */
  readonly deleteComponentThumbnail: (componentId: string) => void;
}

export class DiagramThumbnailStore extends Context.Tag("DiagramThumbnailStore")<
  DiagramThumbnailStore,
  DiagramThumbnailStoreApi
>() {
  /**
   * Drops every thumbnail on the floor. For callers with no disk, and for tests
   * that assert on rows rather than on files.
   */
  static readonly noop: Layer.Layer<DiagramThumbnailStore> = Layer.succeed(
    DiagramThumbnailStore,
    {
      writeDiagramThumbnail: () => {},
      writeComponentThumbnail: () => {},
      deleteComponentThumbnail: () => {},
    }
  );

  /** Collects what it was asked to store, so a test can assert on it. */
  static readonly recording = (): {
    readonly layer: Layer.Layer<DiagramThumbnailStore>;
    readonly written: Map<string, Buffer>;
  } => {
    const written = new Map<string, Buffer>();
    return {
      written,
      layer: Layer.succeed(DiagramThumbnailStore, {
        writeDiagramThumbnail: (diagramId, contentHash, png) => {
          written.set(`${diagramId}/${contentHash}`, png);
        },
        writeComponentThumbnail: (componentId, png) => {
          written.set(`_components/${componentId}`, png);
        },
        deleteComponentThumbnail: (componentId) => {
          written.delete(`_components/${componentId}`);
        },
      }),
    };
  };
}
