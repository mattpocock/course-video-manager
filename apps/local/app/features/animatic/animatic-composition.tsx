import { AbsoluteFill, Audio, Sequence, Series } from "remotion";
import { subtitleCuesForSegment } from "./animatic-subtitles";
import {
  CLIP_MOCKUP_PREMOUNT_IN_FRAMES,
  type AnimaticSegment,
} from "./animatic-timeline";

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
  /** Draw each line over its frame as subtitles. See `animatic-subtitles.ts`. */
  showSubtitles: boolean;
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

/**
 * One phrase of the line, low and centred, as a student's player draws
 * subtitles. Sized in composition pixels, so it scales with the picture.
 */
const AnimaticSubtitle = (props: { text: string }) => (
  <AbsoluteFill
    style={{
      justifyContent: "flex-end",
      alignItems: "center",
      paddingBottom: "7%",
    }}
  >
    <div
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        color: "white",
        fontFamily: "Inter, sans-serif",
        fontSize: 52,
        fontWeight: 600,
        lineHeight: 1.3,
        padding: "10px 28px",
        borderRadius: 12,
        textAlign: "center",
      }}
    >
      {props.text}
    </div>
  </AbsoluteFill>
);

const AnimaticSegmentFrame = (props: {
  segment: AnimaticSegment;
  showSubtitles: boolean;
}) => {
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
      {/* The missing-frame card already prints the whole line. */}
      {props.showSubtitles &&
        !mockup.imageMissing &&
        subtitleCuesForSegment(props.segment).map((cue) => (
          <Sequence
            key={cue.fromFrame}
            from={cue.fromFrame}
            durationInFrames={cue.durationInFrames}
            layout="none"
          >
            <AnimaticSubtitle text={cue.text} />
          </Sequence>
        ))}
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
          // The frame is fetched and decoded during the Clip Mockup before
          // this one, so its first frame is painted rather than black. See
          // `CLIP_MOCKUP_PREMOUNT_IN_FRAMES`.
          premountFor={CLIP_MOCKUP_PREMOUNT_IN_FRAMES}
        >
          <AnimaticSegmentFrame
            segment={segment}
            showSubtitles={props.showSubtitles}
          />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);
