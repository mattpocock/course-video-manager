/** The Active Diagram page's data, as `diagramPlaygroundReducer` holds it. */

import type { TLStoreSnapshot } from "tldraw";
import type { VideoFormat } from "@/features/videos/video-format";
import type { Snapshot } from "./snapshot-list";

/**
 * Where the open diagram's head stands. Only a `ready` canvas holds the
 * stored head, so only a `ready` canvas may be edited or saved.
 */
export type HeadStatus = "loading" | "failed" | "ready";

/**
 * A Diagram's head as the server stores it: the content hash of its drawing
 * (`null` when it has never been drawn on) and when it was last written.
 */
export interface StoredHead {
  hash: string | null;
  /** ISO time. */
  updatedAt: string;
}

/** The Active Diagram's head, as the canvas holds it. */
export interface CanvasHead {
  diagramId: string;
  status: HeadStatus;
  /** The stored head this tab last loaded or saved; `null` until it loads. */
  seen: StoredHead | null;
  /** One of this tab's autosaves is on its way to the server. */
  saving: boolean;
  /**
   * The stored head changed elsewhere while the canvas had unsaved edits, so
   * neither was overwritten: the author picks which one to keep.
   */
  changedElsewhere: boolean;
  /** A reload in place: the new head keeps the camera where it is. */
  keepCamera: boolean;
  /**
   * The author answered "changed elsewhere" with "Keep my edits", and no head
   * has loaded since. A save refused now means their choice didn't stick.
   */
  keptMyEdits: boolean;
  /**
   * The canvas, edits the server refused and all, is kept as a preserved
   * snapshot: leaving it now loses nothing.
   */
  keptAsSnapshot: boolean;
}

/** Where a held navigation was going, so it can be sent on its way. */
export interface LeaveDestination {
  to: string;
  replace: boolean;
}

/**
 * A restore waiting for the head it overwrites to be held on the timeline:
 * the canvas's last edit saved, then, unless `timeline` already holds that
 * head, the canvas kept as a preserved snapshot.
 */
export interface PendingRestore {
  snapshot: Snapshot;
  /** The snapshots the timeline showed when the restore was asked for. */
  timeline: readonly { contentHash: string }[];
  requestId: number;
}

/**
 * How the save made before leaving settled. `saved` also covers a canvas that
 * turned out to have nothing new to save.
 */
export type LeaveSaveOutcome = "saved" | "refused" | "failed";

/**
 * The one error the page's status line shows. Toasts are off on this page
 * (`handle = NO_TOASTS`), so every failure is reported here and nowhere else;
 * a success is never shown, it only clears the error.
 */
export interface StatusError {
  message: string;
  /** Tells this error's timeout apart from a later error's. */
  id: number;
  /**
   * An autosave's own failure. Autosaves run on every pause in drawing, so
   * only an autosave error clears on the next autosave that lands; any other
   * error waits for a success the author asked for.
   */
  fromAutosave: boolean;
}

/** What `diagramPlaygroundReducer` asks its runner to do. */
/**
 * What the video editor reports on every heartbeat: whether a take is
 * recording, and the Video's format, which says where a take-start centres.
 * The playground adds whether its window is full screen.
 */
export interface RecordingStatus {
  recording: boolean;
  format: VideoFormat;
  /**
   * Not the editor's: whether this window was already full screen, in either
   * way, as the status arrived (`full-screen.ts`).
   */
  fullScreen: boolean;
}

export type DiagramPlaygroundEffect =
  /**
   * Fetch `diagramId`'s head. With `saveOpenHeadFirst`, the head currently
   * open is saved before the canvas stops saving — leaving a diagram keeps
   * its edits; reloading the same one discards them.
   */
  | { type: "load-head"; diagramId: string; saveOpenHeadFirst: boolean }
  /**
   * Put `scene` on the canvas as `diagramId`'s stored head; edits now save,
   * and only over `stored`.
   */
  | {
      type: "show-head";
      diagramId: string;
      scene: TLStoreSnapshot | null;
      stored: StoredHead;
      /** Centre the camera for this format once shown; `null` leaves it. */
      centreFor: VideoFormat | null;
    }
  /** Save the canvas over whatever head is stored now, seen or not. */
  | { type: "overwrite-stored-head"; diagramId: string }
  /** Don't leave the previous diagram's shapes standing in for this one. */
  | { type: "clear-canvas" }
  | {
      type: "restore-snapshot";
      diagramId: string;
      snapshot: Snapshot;
      /** The head this tab last saw; the server keeps any other first. */
      expectedHeadHash: string | null;
      requestId: number;
    }
  /** The restore won't happen; whoever asked can stop waiting. */
  | { type: "release-restore-request"; requestId: number }
  | { type: "preserve-snapshot"; diagramId: string }
  /** Save the canvas's pending edits as the head now, and report back. */
  | { type: "save-before-leaving"; diagramId: string }
  /**
   * Store the canvas as it stands — not the stored head — as one of
   * `diagramId`'s preserved snapshots.
   */
  | { type: "keep-canvas-as-snapshot"; diagramId: string }
  /** Send the held navigation on its way. */
  | { type: "continue-leaving"; destination: LeaveDestination }
  | { type: "create-diagram" }
  | { type: "go-to-diagram"; diagramId: string }
  | {
      type: "take-clip-snapshot";
      clipId: string;
      diagramId: string;
      diagramName: string | null;
    }
  | {
      type: "report-clip-snapshot";
      clipId: string;
      ok: boolean;
      snapshotId: string | null;
      diagramName: string | null;
    }
  /** Report `error-timed-out` for error `id` once `ms` have passed. */
  | { type: "time-out-error"; id: number; ms: number }
  /** Turn tldraw's Focus Mode on (sidebar hidden) or off (sidebar shown). */
  | { type: "set-focus-mode"; isFocusMode: boolean }
  /**
   * Centre the camera on the diagram (`centreCameraOnContent`) once the layout
   * has caught up with any sidebar change declared alongside it, so the fit
   * uses the canvas's new size. `format` is the playground's Video's: a Short
   * centres in the square it shows, with no face-cam strip.
   */
  | { type: "centre-camera-after-layout"; format: VideoFormat }
  /**
   * Put the window full screen. Asked for only when it isn't already, in
   * either way (`full-screen.ts`): asking again re-shows the browser's exit
   * notice.
   */
  | { type: "enter-full-screen" };
