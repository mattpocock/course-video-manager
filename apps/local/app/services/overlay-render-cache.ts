import crypto from "node:crypto";
import path from "node:path";
import { VIDEO_FORMAT_DIMENSIONS } from "@/features/videos/video-format";
import {
  bulletPanelHashPayload,
  type BulletPanelBullet,
} from "@/features/videos/bullet-panel";
import type { OverlayKind } from "@/features/videos/overlay-kind";

/**
 * The frame every Overlay's own content is rendered at.
 *
 * Overlay content — a Definition Card, a Bullet Panel — is a landscape/course-
 * video feature, so it is rendered at the landscape export frame and
 * composited 1:1 onto it. It is a constant, not a per-Overlay input, so it
 * stays out of the content address — see {@link OVERLAY_RENDERER_VERSION}.
 */
export const OVERLAY_RENDER_FRAME = VIDEO_FORMAT_DIMENSIONS.landscape;

/**
 * The frame rate every Overlay's content is rendered at. A constant for the
 * same reason {@link OVERLAY_RENDER_FRAME} is: the content is a short,
 * self-contained clip whose only job is to be legible for its own duration, so
 * it does not have to match the frame rate of whatever footage it lands on.
 */
export const OVERLAY_RENDER_FPS = 60;

/**
 * The Overlay Renderer Version — a sibling to `EXPORT_VERSION` (the Export
 * Version Key), bumped independently of it.
 *
 * Bump this when a change to the renderer makes an already-cached Overlay
 * render wrong: new branding, a new layout, different encoding settings, a
 * different render frame or frame rate. Every cached `.mov` then has a stale
 * address and the next export re-renders it.
 *
 * It is deliberately NOT the Export Version Key. A branding change should
 * re-render the Overlay content and nothing else — bumping the Export Version
 * Key would force every video in the library through ffmpeg again. The reverse
 * holds too: an ffmpeg-settings change re-exports videos while every cached
 * render stays valid.
 *
 * Adding a NEW content-kind does not bump it. A kind that did not exist has no
 * cached renders to invalidate, and its content address is disjoint from every
 * other kind's (see {@link overlayContentHashAtVersion}), so `bulletPanel`
 * arrived without re-rendering a single Definition Card.
 *
 * It lives here, in `apps/local`, rather than in the renderer package, because
 * the *render* path (`@cvm/overlay-renderer`'s `"."` export — `@remotion/bundler`
 * + `@remotion/renderer` + Chromium) is still not a workspace dependency of this
 * app; the subprocess (`overlay-renderer-bin.ts`) is the only coupling to it and
 * importing across it would drag Remotion's Node/Chromium toolchain into every
 * root check. This app does now depend on the package's separate `"./card"`
 * export (a plain browser-safe component, for the in-editor overlay preview —
 * see `overlay-preview.tsx`), which carries none of that. Whoever changes the
 * renderer bumps this by hand.
 */
export const OVERLAY_RENDERER_VERSION = 1;

/**
 * Everything about a Definition Card that its rendered `.mov` depends on.
 *
 * The card's frame and frame rate are absent because they are constants
 * ({@link OVERLAY_RENDER_FRAME}, {@link OVERLAY_RENDER_FPS}) rather than
 * per-card inputs. Changing either one changes every render, which is exactly
 * what {@link OVERLAY_RENDERER_VERSION} is for.
 */
export type DefinitionCardContent = {
  /** `Extract` and not a bare literal, so dropping the Kind fails to compile. */
  kind: Extract<OverlayKind, "definitionCard">;
  title: string;
  description: string;
  durationInSeconds: number;
};

/**
 * Everything about a Bullet Panel that its rendered `.mov` depends on.
 *
 * The Animation Toggles are here, and are NOT on the Definition Card, because
 * they are the one Overlay-level field that reaches into what is drawn: they
 * collapse the panel's own enter/exit to a hard cut, so two otherwise-identical
 * panels that differ only in a toggle are two different sets of frames and must
 * be two different files. (They also govern the camera Transform, but that is
 * ffmpeg's business at composite time, not this render's.)
 *
 * Each bullet's `revealAt` stays in SECONDS since the panel's own start — the
 * form it is authored in and the form the renderer's `bulletPanelSchema` takes.
 */
export type BulletPanelContent = {
  kind: Extract<OverlayKind, "bulletPanel">;
  title: string;
  bullets: BulletPanelBullet[];
  durationInSeconds: number;
  disableEnterAnimation: boolean;
  disableExitAnimation: boolean;
};

/**
 * Everything about ONE Overlay's visible content that its rendered `.mov`
 * depends on, whichever Overlay Kind it is.
 *
 * Nothing else does: the Overlay's `id`, which Clip it is anchored to, and
 * where in the video it lands all decide *where the render is composited*, not
 * *what it looks like* — so two Overlays with the same content anywhere in the
 * library share one render.
 *
 * It is discriminated by the same `kind` vocabulary the DB column and the
 * Export Hash use (`features/videos/overlay-kind.ts`), so adding a third kind
 * makes every exhaustive branch over it a compile error until it is answered
 * for.
 */
export type OverlayContent = DefinitionCardContent | BulletPanelContent;

/**
 * The content address one Overlay's content would have at a given Overlay
 * Renderer Version.
 *
 * The version-explicit form exists so "a bump invalidates every cached render"
 * is a property anyone — a test, or a future pruning job asked to sweep up
 * renders from older versions — can ask about directly, instead of having to
 * edit the constant to find out.
 *
 * A Definition Card's payload has NO kind key, exactly as the Export Hash omits
 * `k` for the default Kind: every render cached before Overlay Kind existed is
 * a Definition Card, and omitting the default is what let a second kind arrive
 * without re-rendering any of them. Every other kind names itself, so two kinds
 * can never collide on one address.
 */
export const overlayContentHashAtVersion = (
  content: OverlayContent,
  rendererVersion: number
): string =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(hashPayload(content, rendererVersion)))
    .digest("hex")
    .slice(0, 32);

const hashPayload = (content: OverlayContent, v: number) => {
  switch (content.kind) {
    case "definitionCard":
      return {
        v,
        t: content.title,
        x: content.description,
        d: content.durationInSeconds,
      };
    case "bulletPanel":
      // Every bullet is spelled out: editing its text, its icon or its reveal
      // time all change the rendered frames, so all three move the address.
      // The encoding is `bulletPanelHashPayload`'s, shared with the Export
      // Hash: one encoder, so the two addresses agree by construction rather
      // than by two people remembering the same three keys.
      return {
        v,
        k: content.kind,
        t: content.title,
        d: content.durationInSeconds,
        b: bulletPanelHashPayload(content.bullets),
        ne: content.disableEnterAnimation,
        nx: content.disableExitAnimation,
      };
  }
};

/**
 * The content address of one Overlay's render: a 32-char hex digest of the
 * content plus the current Overlay Renderer Version.
 *
 * Deterministic and pure — the same content always names the same file, which
 * is the whole point: a cache hit is "this file already exists", never a
 * lookup table someone has to keep in step with the renders on disk.
 */
export const computeOverlayContentHash = (content: OverlayContent): string =>
  overlayContentHashAtVersion(content, OVERLAY_RENDERER_VERSION);

/**
 * The filename of one cached Overlay render: `{courseId}-{contentHash}.mov`.
 *
 * The `courseId` prefix mirrors the exported video's `{courseId}-{hash}.mp4`
 * and exists for the same reason: it makes "throw away everything cached for
 * this course" a glob. It also means the same content under two courses is
 * rendered — and stored — twice. That is deliberate; per-course pruning is
 * worth more than the one render it saves.
 *
 * A standalone video (no course) has no `courseId`; callers pass the video's
 * own id, exactly as the export path does.
 */
export const overlayRenderFilename = (
  courseId: string,
  contentHash: string
): string => `${courseId}-${contentHash}.mov`;

/**
 * Where an Overlay's render lives, or would live, inside the Overlay Render
 * Cache directory.
 */
export const resolveOverlayRenderPath = (
  overlayRenderCacheDir: string,
  courseId: string,
  content: OverlayContent
): string =>
  path.join(
    overlayRenderCacheDir,
    overlayRenderFilename(courseId, computeOverlayContentHash(content))
  );
