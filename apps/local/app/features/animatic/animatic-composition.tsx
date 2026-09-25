import { AbsoluteFill, Audio, Series } from "remotion";
import type { AnimaticSegment } from "./animatic-timeline";

/**
 * The Animatic itself: every Clip Mockup's frame in order, each held for the
 * length of its own line with that line's speech over it, and the 0.08 s gap
 * after it (see `CLIP_MOCKUP_GAP_SECONDS`).
 *
 * The only composition in this repo made of stills — `@cvm/overlay-renderer`
 * is overlay-only, and this deliberately does not live there: it is never
 * rendered to an `.mp4`, only played. ffmpeg has no still-image input path
 * here, and an `.mp4` would give up the scrub bar and the per-Clip-Mockup jump
 * that are the whole reason the author watches this.
 *
 * `type`, not `interface`, on the props: `<Player>` constrains `inputProps` to
 * `Record<string, unknown>`, which an interface does not satisfy.
 */
export type AnimaticCompositionProps = {
  segments: AnimaticSegment[];
};

/**
 * A Clip Mockup whose frame is not on disk. Drawn rather than left black on
 * purpose: a blank frame during playback is indistinguishable from a frame
 * that is simply dark, and the author would blame the picture instead of the
 * file.
 */
const MissingFrame = (props: { position: number; line: string }) => (
  <AbsoluteFill
    style={{
      backgroundColor: "#1c1917",
      color: "#fca5a5",
      alignItems: "center",
      justifyContent: "center",
      padding: 96,
      textAlign: "center",
      gap: 24,
      fontFamily: "Inter, sans-serif",
    }}
  >
    <div style={{ fontSize: 40, fontWeight: 700 }}>
      Clip Mockup {props.position}: frame missing
    </div>
    <div style={{ fontSize: 28, color: "#e7e5e4", maxWidth: 1400 }}>
      {props.line}
    </div>
  </AbsoluteFill>
);

const AnimaticSegmentFrame = (props: { segment: AnimaticSegment }) => {
  const { mockup } = props.segment;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {mockup.imageMissing ? (
        <MissingFrame position={mockup.position} line={mockup.line} />
      ) : (
        // A plain `<img>`, not Remotion's `<Img>`: `<Img>` fails the whole
        // composition when a source will not load, and this is a Player over
        // files on the author's own disk, not a headless render that must
        // block for them.
        <img
          src={mockup.imageUrl}
          alt={mockup.line}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      )}
      {mockup.audioUrl !== null && !mockup.audioMissing && (
        <Audio src={mockup.audioUrl} />
      )}
    </AbsoluteFill>
  );
};

export const AnimaticComposition = (props: AnimaticCompositionProps) => (
  <AbsoluteFill style={{ backgroundColor: "black" }}>
    <Series>
      {props.segments.map((segment) => (
        <Series.Sequence
          key={segment.mockup.id}
          durationInFrames={segment.durationInFrames}
        >
          <AnimaticSegmentFrame segment={segment} />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);
