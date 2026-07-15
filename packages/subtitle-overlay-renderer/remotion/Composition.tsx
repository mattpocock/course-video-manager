import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/FiraCode";
import type { Cta, OverlayProps } from "../src/props";

// Load Fira Code so the overlay is self-contained and does not depend on a
// system-installed font. This reproduces the `font-family: "Fira Code"` the
// original renderer requested in its global CSS.
const { fontFamily } = loadFont();

// Accepts the full render props (so Remotion's `calculateMetadata` sees
// width/height/fps/durationInFrames) but only draws from subtitles + cta.
export const SubtitleOverlay = ({ subtitles, cta }: OverlayProps) => {
  return (
    <AbsoluteFill style={{ fontFamily }}>
      {subtitles.map((subtitle, index, arr) => (
        <Sequence
          key={index}
          from={subtitle.startFrame - 2}
          durationInFrames={
            index === arr.length - 1
              ? Infinity
              : // A very short word can have its start/end round to the same
                // frame, collapsing this segment to zero (or fewer) frames.
                // Remotion requires a positive duration, so clamp to >= 1.
                Math.max(1, subtitle.endFrame - subtitle.startFrame)
          }
        >
          <AbsoluteFill className="flex items-center justify-center">
            <Subtitle text={subtitle.text} isFirst={index === 0} />
          </AbsoluteFill>
        </Sequence>
      ))}
      {cta !== null && (
        <Sequence durationInFrames={cta.durationInFrames}>
          <AbsoluteFill className="flex flex-col">
            <CTAPill
              variant={cta.variant}
              durationInFrames={cta.durationInFrames}
            />
          </AbsoluteFill>
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

const FADE_DURATION = 8;
const MOVE_DISTANCE = 30;
const FADE_OUT_BUFFER_BEFORE_END = 4;

// Each branded CTA image ships its own horizontal padding so the artwork sits
// with the right margins. Keyed by the `variant` prop.
const CTA_IMAGES: Record<Cta["variant"], { src: string; padding: string }> = {
  ai: { src: "/ai-cta.png", padding: "px-24" },
  typescript: { src: "/typescript-cta.png", padding: "px-6" },
};

const CTAPill = ({
  variant,
  durationInFrames,
}: {
  variant: Cta["variant"];
  durationInFrames: number;
}) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [
      0,
      FADE_DURATION,
      durationInFrames - FADE_DURATION - FADE_OUT_BUFFER_BEFORE_END,
      durationInFrames - FADE_OUT_BUFFER_BEFORE_END,
    ],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  // Drift up from 0px to -MOVE_DISTANCE px over the animation.
  const translateY = interpolate(
    frame,
    [0, durationInFrames - FADE_OUT_BUFFER_BEFORE_END],
    [0, -MOVE_DISTANCE],
    {}
  );

  const { src, padding } = CTA_IMAGES[variant];

  return (
    <>
      <div className="flex-1"></div>
      <div className="flex flex-1 items-center justify-center ">
        <div
          className={`w-full h-full flex items-center justify-center ${padding}`}
        >
          <Img
            src={staticFile(src)}
            className="w-full h-full object-contain"
            style={{
              opacity,
              transform: `translateY(${translateY}px)`,
            }}
          />
        </div>
      </div>
    </>
  );
};

const ANIMATION_DURATION = 8;
const BASE_Y_TRANSFORM = 122;

const Subtitle = ({ text, isFirst }: { text: string; isFirst: boolean }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [0, ANIMATION_DURATION],
    [
      // If it's the first subtitle, no animation
      isFirst ? 1 : 0.5,
      1,
    ],
    {
      extrapolateRight: "clamp",
    }
  );

  const y = interpolate(
    frame,
    [0, ANIMATION_DURATION],
    [
      // If it's the first subtitle, no animation
      isFirst ? 0 : 20,
      0,
    ],
    {
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    }
  );

  return (
    <div
      className="mx-12 font-semibold p-6"
      style={{
        opacity,
        transform: `translateY(${y + BASE_Y_TRANSFORM}px)`,
      }}
    >
      <p className="text-amber-200 leading-20 text-5xl text-balance text-center inline-block">
        {text.split(" ").map((word, index) => (
          <span key={index} className={`relative inline-block mx-3`}>
            <div className="absolute -top-2 -left-8 -right-8 -bottom-2 bg-stone-900" />
            <span className="relative z-10">{word}</span>
          </span>
        ))}
      </p>
    </div>
  );
};
