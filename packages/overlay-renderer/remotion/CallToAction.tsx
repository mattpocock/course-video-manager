import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { loadFont as loadFiraCode } from "@remotion/google-fonts/FiraCode";
import { loadFont as loadDmSans } from "@remotion/google-fonts/DMSans";
import type { CallToAction } from "../src/props";

// The old AI Hero card's look: a monospaced bold headline over a sans subline.
const { fontFamily: headlineFont } = loadFiraCode();
const { fontFamily: sublineFont } = loadDmSans();

/** The old pill's motion: an 8-frame fade at each end, a 30 px drift up. */
const FADE_DURATION = 8;
const MOVE_DISTANCE = 30;
/** The fade out finishes this many frames before the card's last frame. */
const FADE_OUT_BUFFER_BEFORE_END = 4;

/**
 * A Short's Calls to Action, each in its own Sequence, centred in the lower
 * half of the frame: below the centred captions, clear of the Chat Card at the
 * top.
 */
export const CallsToAction = ({ cards }: { cards: CallToAction[] }) => (
  <>
    {cards.map((card, index) => (
      <Sequence
        key={index}
        from={card.startFrame}
        // Remotion requires a positive duration.
        durationInFrames={Math.max(1, card.durationInFrames)}
      >
        <AbsoluteFill className="flex flex-col">
          <div className="flex-1" />
          <div className="flex flex-1 items-center justify-center">
            <Card card={card} />
          </div>
        </AbsoluteFill>
      </Sequence>
    ))}
  </>
);

const Card = ({ card }: { card: CallToAction }) => {
  const frame = useCurrentFrame();
  if (card.title === "" && card.description === "") return null;
  const end = Math.max(1, card.durationInFrames - FADE_OUT_BUFFER_BEFORE_END);
  const clamp = {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  } as const;

  const fadeIn = card.disableEnterAnimation
    ? 1
    : interpolate(frame, [0, FADE_DURATION], [0, 1], clamp);
  const fadeOut = card.disableExitAnimation
    ? 1
    : interpolate(frame, [end - FADE_DURATION, end], [1, 0], clamp);
  // Drifts up across the whole card, whichever ends hard-cut.
  const translateY = interpolate(frame, [0, end], [0, -MOVE_DISTANCE]);

  return (
    <div
      className="flex flex-col items-start"
      style={{
        opacity: Math.min(fadeIn, fadeOut),
        transform: `translateY(${translateY}px)`,
        maxWidth: 960,
        gap: 16,
        padding: "48px 60px",
        borderRadius: 12,
        background: "#0A0A0A",
        boxShadow: "0 12px 40px rgba(0, 0, 0, 0.35)",
      }}
    >
      {card.title !== "" && (
        <p
          style={{
            fontFamily: headlineFont,
            fontSize: 100,
            fontWeight: 700,
            lineHeight: 1.1,
            color: "#FFFFFF",
            overflowWrap: "anywhere",
          }}
        >
          {card.title}
        </p>
      )}
      {card.description !== "" && (
        <p
          style={{
            fontFamily: sublineFont,
            fontSize: 52,
            fontWeight: 400,
            lineHeight: 1.25,
            color: "#EADBD5",
          }}
        >
          {card.description}
        </p>
      )}
    </div>
  );
};
