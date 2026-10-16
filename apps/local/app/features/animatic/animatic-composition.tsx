import {
  AbsoluteFill,
  Audio,
  Sequence,
  Series,
  useCurrentFrame,
} from "remotion";
import type { VideoFormat } from "@/features/videos/video-format";
import { useAnimaticAudioPrefetch } from "./animatic-audio-prefetch";
import {
  subtitleCuesForSegment,
  type AnimaticSubtitleStyle,
} from "./animatic-subtitles";
import {
  ANIMATIC_FPS,
  CLIP_MOCKUP_PREMOUNT_IN_FRAMES,
  segmentIndexAtFrame,
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
  /**
   * The Video's format: a Short's frames are 1080x1920, and its subtitles sit
   * where the finished Short's captions do.
   */
  format: VideoFormat;
  /** Draw each line over its frame as subtitles. See `animatic-subtitles.ts`. */
  showSubtitles: boolean;
  /** Where, how big and how wide. See `AnimaticSubtitleStyle`. */
  subtitleStyle: AnimaticSubtitleStyle;
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
    <div style={{ fontSize: 28, color: "#e7e5e4", maxWidth: "100%" }}>
      {props.line}
    </div>
  </AbsoluteFill>
);

/**
 * One phrase of the line, low and centred, as a student's player draws
 * subtitles — then moved, sized and narrowed by the author's own style. Sized
 * in composition pixels, so it scales with the picture.
 */
const LandscapeSubtitle = (props: {
  text: string;
  style: AnimaticSubtitleStyle;
}) => (
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
        fontSize: props.style.fontSize,
        fontWeight: 600,
        lineHeight: 1.3,
        padding: "10px 28px",
        borderRadius: 12,
        textAlign: "center",
        maxWidth: `${props.style.maxWidthCh}ch`,
        transform: `translateY(${-props.style.offsetY}px)`,
      }}
    >
      {props.text}
    </div>
  </AbsoluteFill>
);

/**
 * How far below the frame's middle a Short's captions sit: the overlay
 * renderer's `BASE_Y_TRANSFORM` (`packages/overlay-renderer/remotion/
 * Composition.tsx`), which centres each caption and moves it this far down —
 * onto the seam between a Code frame's screen and its camera band. Copied, not
 * imported: `apps/local` only ever shells out to that package.
 */
const SHORT_CAPTION_OFFSET_Y = 122;

/**
 * One phrase of a Short's line, drawn where and as the finished Short draws
 * its captions: centred, just below the middle, amber words on dark blocks,
 * in Fira Code. The author's offset and size still apply, so a caption can be
 * moved off the thing being judged.
 */
const ShortSubtitle = (props: {
  text: string;
  style: AnimaticSubtitleStyle;
}) => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
    <p
      style={{
        margin: "0 48px",
        padding: 24,
        color: "#fde68a",
        fontFamily: '"Fira Code", ui-monospace, monospace',
        fontSize: props.style.fontSize,
        fontWeight: 600,
        lineHeight: 1.6,
        textAlign: "center",
        textWrap: "balance",
        transform: `translateY(${SHORT_CAPTION_OFFSET_Y - props.style.offsetY}px)`,
      }}
    >
      {props.text.split(" ").map((word, index) => (
        <span
          key={index}
          style={{
            display: "inline-block",
            margin: "0 12px",
            padding: "4px 16px",
            backgroundColor: "#1c1917",
          }}
        >
          {word}
        </span>
      ))}
    </p>
  </AbsoluteFill>
);

const AnimaticSubtitle = (props: {
  text: string;
  style: AnimaticSubtitleStyle;
  format: VideoFormat;
}) =>
  props.format === "short" ? (
    <ShortSubtitle text={props.text} style={props.style} />
  ) : (
    <LandscapeSubtitle text={props.text} style={props.style} />
  );

const AnimaticSegmentFrame = (props: {
  segment: AnimaticSegment;
  format: VideoFormat;
  showSubtitles: boolean;
  subtitleStyle: AnimaticSubtitleStyle;
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
        // Started past Kokoro's leading silence, so the voice comes in with
        // the frame rather than a third of a second after it (#2265).
        <Audio
          src={mockup.audioUrl}
          trimBefore={Math.round(mockup.speechStartSeconds * ANIMATIC_FPS)}
        />
      )}
      {/* The missing-frame card already prints the whole line. */}
      {props.showSubtitles &&
        !mockup.imageMissing &&
        subtitleCuesForSegment(props.segment, props.format).map((cue) => (
          <Sequence
            key={cue.fromFrame}
            from={cue.fromFrame}
            durationInFrames={cue.durationInFrames}
            layout="none"
          >
            <AnimaticSubtitle
              text={cue.text}
              style={props.subtitleStyle}
              format={props.format}
            />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
};

/** Holds the next lines' speech in memory. See `animatic-audio-prefetch.ts`. */
const AudioPrefetch = (props: { segments: AnimaticSegment[] }) => {
  const frame = useCurrentFrame();
  useAnimaticAudioPrefetch(
    props.segments,
    segmentIndexAtFrame(props.segments, frame)
  );
  return null;
};

export const AnimaticComposition = (props: AnimaticCompositionProps) => (
  <AbsoluteFill style={{ backgroundColor: "black" }}>
    <AudioPrefetch segments={props.segments} />
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
            format={props.format}
            showSubtitles={props.showSubtitles}
            subtitleStyle={props.subtitleStyle}
          />
        </Series.Sequence>
      ))}
    </Series>
  </AbsoluteFill>
);
