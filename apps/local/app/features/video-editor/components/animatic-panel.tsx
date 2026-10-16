import { useContextSelector } from "use-context-selector";
import { cn } from "@/lib/utils";
import type { AnimaticLine } from "@/features/animatic/animatic-lines";
import { clipMockupFrameUrl } from "@/features/clip-mockups/clip-mockup-frame-url";
import {
  VIDEO_FORMAT_DIMENSIONS,
  type VideoFormat,
} from "@/features/videos/video-format";
import { VideoEditorContext } from "../video-editor-context";
import { AnimaticOverlay } from "./animatic-overlay";

/** A line's Clip Mockup Comments, as a margin note under it. */
function PanelComments({ comments }: { comments: readonly string[] }) {
  if (comments.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-0.5 border-l-2 border-amber-400/70 pl-2 text-xs font-normal normal-case tracking-normal text-amber-700 dark:text-amber-300">
      {comments.map((body, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {body}
        </p>
      ))}
    </div>
  );
}

/**
 * How tall a line's thumbnail is, per Video Format. Its shape comes from
 * `VIDEO_FORMAT_DIMENSIONS`, so a Short's 1080x1920 frame fills a narrow 9:16
 * column instead of sitting letterboxed in a 16:9 box. A Short's is taller so
 * the frame stays legible at a column narrower than a Landscape one.
 */
const THUMBNAIL_HEIGHT: Record<VideoFormat, string> = {
  landscape: "h-12",
  short: "h-24",
};

/**
 * The editor side slot's **Animatic** tab: this video's Clip Mockups read as
 * lines, one clip at a time, under their Clip Mockup Chapters — each with a
 * small thumbnail of its still, so you can check a filmed Clip against what
 * was planned for that moment.
 *
 * READ-ONLY on purpose — see `EditorSidePanel`. No drag, no line editor.
 *
 * Clicking a row OPENS THE ANIMATIC PLAYER over the editor, playing from that
 * Clip Mockup (`AnimaticOverlay`). The editor's own playback pauses, a Take
 * being recorded is stopped, and the player owns the keys until ESC closes it.
 *
 * The number is the Clip Mockup's position, the same one the Animatic page
 * shows, so "number 14" means the same clip in both places.
 */
export function AnimaticPanel(props: { lines: AnimaticLine[] }) {
  const dispatch = useContextSelector(VideoEditorContext, (c) => c.dispatch);
  // A Take being recorded is stopped from here.
  const takeRecording = useContextSelector(
    VideoEditorContext,
    (c) => c.cvmRecorder.canStop
  );
  const format = useContextSelector(VideoEditorContext, (c) => c.videoFormat);
  const frame = VIDEO_FORMAT_DIMENSIONS[format];

  return (
    <div className="overflow-y-auto flex-1 px-3 py-2">
      <AnimaticOverlay />
      {props.lines.map((line) =>
        line.type === "chapter" ? (
          <div
            key={line.id}
            className="mt-4 mb-2 border-b pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-1"
          >
            {line.name}
            <PanelComments comments={line.comments} />
          </div>
        ) : (
          <div
            key={line.id}
            // A div rather than a button: the editor's shortcuts ignore any
            // key whose target is a button, so a focused trigger would leave
            // the arrows dead once the player closes.
            onClick={() =>
              dispatch({
                type: "click-animatic-clip-mockup",
                clipMockupId: line.id,
                takeRecording,
              })
            }
            className="flex cursor-pointer gap-2 py-2 border-b border-border/40 last:border-b-0 hover:bg-muted/50"
          >
            <span className="w-5 shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-muted-foreground">
              {line.position}
            </span>
            <img
              src={clipMockupFrameUrl(line.id)}
              alt=""
              loading="lazy"
              className={cn(
                THUMBNAIL_HEIGHT[format],
                "shrink-0 rounded-sm border bg-black object-contain"
              )}
              style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
              // A frame the disk does not have shows as an empty box, not a
              // broken-image glyph. The Animatic page is where a missing file
              // is reported.
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-snug">{line.line}</p>
              <PanelComments comments={line.comments} />
            </div>
          </div>
        )
      )}
    </div>
  );
}
