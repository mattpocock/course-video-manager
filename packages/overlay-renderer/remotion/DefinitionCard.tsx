import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/DMSans";
import type { DefinitionCard } from "../src/props";

// DM Sans is AI Hero's brand typeface. Loaded through @remotion/google-fonts
// (the same mechanism the subtitles use for Fira Code) so the render never
// depends on a system-installed font.
const { fontFamily } = loadFont();

/** The reference frame the card's pixel sizes are authored against. */
const DESIGN_WIDTH = 1920;
const FADE_DURATION = 10;

/**
 * The AI-Hero-branded term Definition Card: a `title` + `description` pair
 * over the footage. Deliberately has no Transform (pan/zoom) — it only fades.
 */
export const DefinitionCards = ({ cards }: { cards: DefinitionCard[] }) => (
  <>
    {cards.map((card, index) => (
      <Sequence
        key={index}
        from={card.startFrame}
        // Remotion requires a positive duration; a zero-length card would
        // otherwise throw rather than simply not being seen.
        durationInFrames={Math.max(1, card.durationInFrames)}
      >
        <Card card={card} />
      </Sequence>
    ))}
  </>
);

const Card = ({ card }: { card: DefinitionCard }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const scale = width / DESIGN_WIDTH;

  const duration = Math.max(1, card.durationInFrames);
  const opacity = interpolate(
    frame,
    [0, FADE_DURATION, duration - FADE_DURATION, duration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      className="flex flex-col justify-end items-start"
      style={{ fontFamily, padding: 96 * scale }}
    >
      <div
        className="flex items-start bg-stone-900/95 text-white"
        style={{
          opacity,
          gap: 32 * scale,
          padding: 40 * scale,
          borderRadius: 24 * scale,
          maxWidth: 760 * scale,
        }}
      >
        <Img
          src={staticFile("/ai-hero-logo.svg")}
          style={{ width: 56 * scale, height: 56 * scale, flexShrink: 0 }}
        />
        <div className="flex flex-col" style={{ gap: 12 * scale }}>
          <p
            className="font-bold leading-tight text-amber-200"
            style={{ fontSize: 48 * scale }}
          >
            {card.title}
          </p>
          <p
            className="font-normal leading-snug text-stone-200"
            style={{ fontSize: 32 * scale }}
          >
            {card.description}
          </p>
        </div>
      </div>
    </AbsoluteFill>
  );
};
