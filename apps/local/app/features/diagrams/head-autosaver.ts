import type { TLStore, TLStoreSnapshot } from "tldraw";
import { after } from "@/packages/clock";

export const HEAD_AUTOSAVE_DEBOUNCE_MS = 500;

/**
 * Names the head a head PATCH may replace: its hash, or `none` for an empty
 * head. Without it, the write is unconditional.
 */
export const EXPECTED_HEAD_HASH_HEADER = "X-Expected-Head-Hash";

/**
 * Debounced autosave of the open diagram's head, which writes only when the
 * canvas differs from the head it last loaded or saved.
 *
 * A store change is not an edit. `loadSnapshot` puts the loaded records under
 * the `"user"` source, and the store delivers them to listeners on the next
 * frame, after the load has returned — so a listener cannot tell opening a
 * diagram from drawing on it. The comparison against what was loaded is what
 * keeps a page that is only opened from writing.
 *
 * Each save names the stored head it replaces (by hash), and the server
 * refuses it if the head has since changed elsewhere: the autosaver never
 * overwrites a head it hasn't seen. Once refused, it stops saving until the
 * author picks a side — `flush({ overwrite: true })`, or a fresh `attach`.
 * Saves run one at a time, so each knows the hash the one before it left.
 *
 * It saves only while attached to a head. When to attach and detach — and so
 * whether the canvas may be edited — is the page reducer's decision
 * (`diagram-playground-reducer.ts`); this module only keeps the store honest.
 */
/** What became of one save. */
export type HeadSaveResult =
  | { outcome: "saved"; headHash: string | null }
  /** The stored head isn't the one named: it changed elsewhere. */
  | { outcome: "refused" }
  | { outcome: "failed" };

/**
 * What a flush left behind: the canvas's edits stored (or nothing to store),
 * refused over a head changed elsewhere, or not saved this time.
 */
export type FlushOutcome = HeadSaveResult["outcome"];

export function createHeadAutosaver(opts: {
  store: TLStore;
  /**
   * Store `document` as `diagramId`'s head, over the head whose hash is
   * `expectedHash` — or over anything when it is `undefined`. Never throws.
   */
  save: (
    diagramId: string,
    document: TLStoreSnapshot,
    expectedHash: string | null | undefined
  ) => Promise<HeadSaveResult>;
  debounceMs: number;
}) {
  const { store } = opts;
  /**
   * The diagram the canvas holds; its head as last loaded or saved, both as
   * the canvas serialized it and as the server hashed it; and whether the
   * server has refused a save over it.
   */
  let head: {
    diagramId: string;
    serialized: string;
    hash: string | null;
    refused: boolean;
  } | null = null;
  let timer: (() => void) | null = null;
  /** The save in progress, if any; the next one starts after it. */
  let queue: Promise<unknown> = Promise.resolve();

  const cancel = () => {
    if (timer) timer();
    timer = null;
  };

  const saveOnce = async (overwrite: boolean): Promise<FlushOutcome> => {
    if (!head) return "saved";
    if (head.refused && !overwrite) return "refused";
    const document = store.getStoreSnapshot("document");
    const serialized = JSON.stringify(document);
    if (serialized === head.serialized) return "saved";
    const target = head;
    const result = await opts.save(
      target.diagramId,
      document,
      overwrite ? undefined : target.hash
    );
    if (result.outcome === "saved") {
      target.serialized = serialized;
      target.hash = result.headHash;
      target.refused = false;
    } else if (result.outcome === "refused") {
      target.refused = true;
    }
    return result.outcome;
  };

  /**
   * Save now if the canvas has changed; resolves once the save has landed,
   * with whether the canvas's edits are now stored.
   * `overwrite` saves over whatever head is stored, even one it hasn't seen.
   */
  const flush = (flushOpts: { overwrite?: boolean } = {}) => {
    cancel();
    const run = queue.then(() => saveOnce(flushOpts.overwrite ?? false));
    queue = run.catch(() => {});
    return run;
  };

  const unlisten = store.listen(
    () => {
      if (!head) return;
      cancel();
      timer = after(opts.debounceMs, () => {
        timer = null;
        // Nothing awaits a debounced save; `save` reports failure, never throws.
        void flush();
      });
    },
    { source: "user", scope: "document" }
  );

  return {
    /**
     * Stop saving — call before a head load touches the canvas, and leave it
     * detached if the load fails, so nothing is saved over the stored diagram.
     */
    detach() {
      cancel();
      head = null;
    },
    /**
     * The canvas now holds `diagramId`'s stored head, whose hash is `hash` —
     * call right after loading or restoring it. Edits from here on are saved.
     */
    attach(diagramId: string, hash: string | null) {
      cancel();
      head = {
        diagramId,
        serialized: JSON.stringify(store.getStoreSnapshot("document")),
        hash,
        refused: false,
      };
    },
    /** Whether the canvas differs from the head it last loaded or saved. */
    hasUnsavedEdits() {
      if (!head) return false;
      return (
        JSON.stringify(store.getStoreSnapshot("document")) !== head.serialized
      );
    },
    flush,
    dispose() {
      cancel();
      unlisten();
    },
  };
}

export type HeadAutosaver = ReturnType<typeof createHeadAutosaver>;
