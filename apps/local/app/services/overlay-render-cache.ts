import crypto from "node:crypto";
import path from "node:path";
import { VIDEO_FORMAT_DIMENSIONS } from "@/features/videos/video-format";

/**
 * The frame every Definition Card is rendered at.
 *
 * Definition Cards are a landscape/course-video feature, so the card is
 * rendered at the landscape export frame and composited 1:1 onto it. It is a
 * constant, not a per-card input, so it stays out of the content address —
 * see {@link OVERLAY_RENDERER_VERSION}.
 */
export const DEFINITION_CARD_FRAME = VIDEO_FORMAT_DIMENSIONS.landscape;

/**
 * The frame rate every Definition Card is rendered at. A constant for the same
 * reason {@link DEFINITION_CARD_FRAME} is: the card is a short, self-contained
 * clip whose only job is to be legible for its own duration, so it does not
 * have to match the frame rate of whatever footage it lands on.
 */
export const DEFINITION_CARD_FPS = 60;

/**
 * The Overlay Renderer Version — a sibling to `EXPORT_VERSION` (the Export
 * Version Key), bumped independently of it.
 *
 * Bump this when a change to the renderer makes an already-cached Definition
 * Card render wrong: new branding, a new layout, different encoding settings,
 * a different card frame or frame rate. Every cached `.mov` then has a stale
 * address and the next export re-renders it.
 *
 * It is deliberately NOT the Export Version Key. A branding change should
 * re-render the cards and nothing else — bumping the Export Version Key would
 * force every video in the library through ffmpeg again. The reverse holds
 * too: an ffmpeg-settings change re-exports videos while every cached card
 * render stays valid.
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
 * Nothing else does: the Overlay's `id`, which Clip it is anchored to, and
 * where in the video it lands all decide *where the card is composited*, not
 * *what the card looks like* — so two Overlays with the same content anywhere
 * in the library share one render.
 *
 * The card's frame and frame rate are absent because they are constants
 * ({@link DEFINITION_CARD_FRAME}, {@link DEFINITION_CARD_FPS}) rather than
 * per-card inputs. Changing either one changes every render, which is exactly
 * what {@link OVERLAY_RENDERER_VERSION} is for.
 */
export type DefinitionCardContent = {
  title: string;
  description: string;
  durationInSeconds: number;
};

/**
 * The content address one Definition Card would have at a given Overlay
 * Renderer Version.
 *
 * The version-explicit form exists so "a bump invalidates every cached render"
 * is a property anyone — a test, or a future pruning job asked to sweep up
 * renders from older versions — can ask about directly, instead of having to
 * edit the constant to find out.
 */
export const definitionCardContentHashAtVersion = (
  content: DefinitionCardContent,
  rendererVersion: number
): string =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        v: rendererVersion,
        t: content.title,
        x: content.description,
        d: content.durationInSeconds,
      })
    )
    .digest("hex")
    .slice(0, 32);

/**
 * The content address of one Definition Card render: a 32-char hex digest of
 * the card's content plus the current Overlay Renderer Version.
 *
 * Deterministic and pure — the same content always names the same file, which
 * is the whole point: a cache hit is "this file already exists", never a
 * lookup table someone has to keep in step with the renders on disk.
 */
export const computeDefinitionCardContentHash = (
  content: DefinitionCardContent
): string =>
  definitionCardContentHashAtVersion(content, OVERLAY_RENDERER_VERSION);

/**
 * The filename of one cached Definition Card render:
 * `{courseId}-{contentHash}.mov`.
 *
 * The `courseId` prefix mirrors the exported video's `{courseId}-{hash}.mp4`
 * and exists for the same reason: it makes "throw away everything cached for
 * this course" a glob. It also means the same card content under two courses
 * is rendered — and stored — twice. That is deliberate; per-course pruning is
 * worth more than the one render it saves.
 *
 * A standalone video (no course) has no `courseId`; callers pass the video's
 * own id, exactly as the export path does.
 */
export const definitionCardFilename = (
  courseId: string,
  contentHash: string
): string => `${courseId}-${contentHash}.mov`;

/**
 * Where a Definition Card's render lives, or would live, inside the Overlay
 * Render Cache directory.
 */
export const resolveDefinitionCardRenderPath = (
  overlayRenderCacheDir: string,
  courseId: string,
  content: DefinitionCardContent
): string =>
  path.join(
    overlayRenderCacheDir,
    definitionCardFilename(courseId, computeDefinitionCardContentHash(content))
  );
