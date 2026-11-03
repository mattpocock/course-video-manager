import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  useCurrentFrame,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/FiraCode";
import type { OverlayProps } from "../src/props";
import { DefinitionCards } from "./DefinitionCard";
import { BulletPanels } from "./BulletPanel";
import { ChatCards } from "./ChatCard";
import { CallsToAction } from "./CallToAction";

// Load Fira Code so the overlay is self-contained and does not depend on a
// system-installed font. This reproduces the `font-family: "Fira Code"` the
// original renderer requested in its global CSS.
const { fontFamily } = loadFont();

// Accepts the full render props (so Remotion's `calculateMetadata` sees
// width/height/fps/durationInFrames) but only draws the content-kinds:
// subtitles + Chat Cards + Calls to Action (vertical Shorts), Definition Cards and Bullet Panels
// (landscape course videos). Every content-kind is optional, so one
// composition serves both pipelines.
export const Overlay = ({
  subtitles,
  definitionCards,
  bulletPanels,
  chatCards,
  callsToAction,
}: OverlayProps) => {
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
      <DefinitionCards cards={definitionCards} />
      <BulletPanels panels={bulletPanels} />
      <ChatCards cards={chatCards} />
      <CallsToAction cards={callsToAction} />
    </AbsoluteFill>
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
