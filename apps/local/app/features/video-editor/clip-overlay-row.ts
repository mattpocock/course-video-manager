import type { BulletPanelBullet } from "@/features/videos/bullet-panel";
import type { ClipOverlay } from "./overlay-preview";
import type { ChatSpinCell } from "@cvm/core/features/videos/chat-card";

/**
 * One row as `OverlayOperationsService.listOverlaysByVideoId` returns it —
 * only the columns the editor takes, so this stays a widening of the query
 * rather than a copy of the table.
 */
type OverlayRow = {
  id: string;
  clipId: string;
  at: number;
  durationInSeconds: number;
  kind: string;
  bullets: BulletPanelBullet[] | null;
  disableEnterAnimation: boolean;
  disableExitAnimation: boolean;
  title: string;
  description: string;
  footagePath: string | null;
  footageStart: number | null;
  chatSpin: ChatSpinCell[] | null;
};

/**
 * A DB row as the editor's client needs it.
 *
 * BOTH Overlay Kinds' content crosses the loader boundary, along with the
 * `kind` that says which of them is the real one and the Animation Toggles the
 * kind-derived camera move reads: `bullets` is null on a Definition Card and
 * `description` is empty on a Bullet Panel, and the client narrows on `kind`
 * exactly as `overlayContent` does on the export side. A B-roll's Footage
 * and `from` cross too (null on the other kinds), as do a Chat Card's spin
 * cells. Sending only one Kind's
 * columns is what used to make the preview draw the wrong thing.
 *
 * A function of its own, in the feature folder rather than in the route, so
 * the projection sits beside the {@link ClipOverlay} it produces.
 */
export const toClipOverlay = (row: OverlayRow): ClipOverlay => ({
  id: row.id,
  clipId: row.clipId,
  at: row.at,
  durationInSeconds: row.durationInSeconds,
  kind: row.kind,
  bullets: row.bullets,
  disableEnterAnimation: row.disableEnterAnimation,
  disableExitAnimation: row.disableExitAnimation,
  title: row.title,
  description: row.description,
  footagePath: row.footagePath,
  footageStart: row.footageStart,
  chatSpin: row.chatSpin,
});
