import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
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

/** The entrance: a short rise, straight up from the bottom, with a small scale. */
const ENTER_DURATION = 18;
const EXIT_DURATION = 10;
const RISE_DISTANCE = 12;
const RISE_EXIT_DISTANCE = 6;
const RISE_START_SCALE = 0.98;

/**
 * The title's underline. It wipes in from the left, holds for a moment, then
 * wipes out to the right — one unhurried left-to-right gesture that nudges the
 * eye into reading the term. It is not a permanent rule; the card is left
 * clean.
 *
 * Both halves decelerate, and both take the same number of frames, so the
 * gesture is symmetrical: it leaves exactly the way it arrived. Neither
 * springs — a bouncing rule reads as a loading bar.
 */
const UNDERLINE_DELAY = 3;
const UNDERLINE_DRAW = 32;
const UNDERLINE_HOLD = 6;
const UNDERLINE_ERASE = UNDERLINE_DRAW;
const UNDERLINE_HEIGHT = 4;
/** The gap between the title's baseline box and the rule. */
const UNDERLINE_GAP = 5;
/** Amber-400. Reads as the brand accent on the dark panel same as it did on white. */
const UNDERLINE_COLOR = "#FBBF24";

/** The brand mark, sized against the 36 px title it stands beside. */
const LOGO_SIZE = 40;
const LOGO_OFFSET = 3;

/**
 * The panel's own ground. Tldraw's dark canvas, `hsl(240, 5%, 6.5%)` — the
 * same near-black the Bullet Panel's ground and the course diagrams use, so
 * every dark surface in an Overlay shares one colour rather than each
 * picking a near-black of its own.
 */
const PANEL_COLOR = "#101011";
/** Stone-300: one step back from the title's white, the same pairing the
 *  Bullet Panel's body text uses against its own dark ground. */
const DESCRIPTION_COLOR = "#D6D3D1";

/**
 * The AI-Hero-branded term Definition Card: a `title` + `description` pair
 * over the footage. Deliberately has no Transform (pan/zoom) — it only rises
 * in, holds, and drops out.
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
  const { width, fps } = useVideoConfig();
  const scale = width / DESIGN_WIDTH;
  const duration = Math.max(1, card.durationInFrames);

  // 0 -> 1 as the card arrives; 0 -> 1 again as it leaves.
  const enter = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: ENTER_DURATION,
  });
  const exit = interpolate(
    frame,
    [duration - EXIT_DURATION, duration],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  // The underline wipes in from the left, then out to the right. Swapping the
  // transform origin between the two phases is what keeps the gesture moving
  // one way: at the swap the rule is at full width, so nothing jumps.
  const drawStart = ENTER_DURATION + UNDERLINE_DELAY;
  const eraseStart = drawStart + UNDERLINE_DRAW + UNDERLINE_HOLD;
  const draw = interpolate(
    frame,
    [drawStart, drawStart + UNDERLINE_DRAW],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );
  const erase = interpolate(
    frame,
    [eraseStart, eraseStart + UNDERLINE_ERASE],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }
  );
  const underline = Math.max(0, draw - erase);

  const y = (1 - enter) * RISE_DISTANCE + exit * RISE_EXIT_DISTANCE;
  const size = RISE_START_SCALE + enter * (1 - RISE_START_SCALE);

  return (
    <AbsoluteFill
      className="flex flex-col justify-end items-start"
      style={{ fontFamily, padding: 96 * scale }}
    >
      {/* The shadow sits on a wrapper as a drop-shadow, not a box-shadow on
          the panel: a box-shadow lies outside the panel's border box, so the
          panel's own overflow clip would cut it off. */}
      <div
        style={{
          opacity: enter * (1 - exit),
          transform: `translateY(${y * scale}px) scale(${size})`,
          // Straight up from the bottom edge — not from a corner.
          transformOrigin: "bottom center",
          filter: `drop-shadow(0 ${10 * scale}px ${24 * scale}px rgba(28,25,23,0.3))`,
        }}
      >
        <div
          className="relative flex items-start overflow-hidden"
          style={{
            background: PANEL_COLOR,
            gap: 32 * scale,
            padding: 40 * scale,
            paddingLeft: (40 + 8) * scale,
            maxWidth: 760 * scale,
            // The left corners are barely rounded, so the amber accent reads as
            // a straight bar rather than a crescent.
            borderRadius: `${8 * scale}px ${24 * scale}px ${24 * scale}px ${
              8 * scale
            }px`,
          }}
        >
          <AccentBar scale={scale} />
          {/* Sized and nudged down so the mark's centre sits on the title's
              cap height, not on the top of the title's line box. The WHITE
              mark — this panel is dark now, so it takes the same mark the
              Bullet Panel's dark ground does. */}
          <Img
            src={staticFile("/ai-hero-logo.svg")}
            style={{
              width: LOGO_SIZE * scale,
              height: LOGO_SIZE * scale,
              marginTop: LOGO_OFFSET * scale,
              flexShrink: 0,
            }}
          />
          <div className="flex flex-col items-start" style={{ gap: 6 * scale }}>
            {/* `inline-block` so the underline is as wide as the title's own
                text, not as wide as the column. A column-wide rule reads as a
                divider instead of an underline. */}
            <p
              className="relative inline-block font-bold leading-tight text-white"
              style={{
                fontSize: 36 * scale,
                paddingBottom: UNDERLINE_GAP * scale,
              }}
            >
              {card.title}
              <span
                className="absolute left-0 bottom-0"
                style={{
                  width: "100%",
                  height: UNDERLINE_HEIGHT * scale,
                  borderRadius: UNDERLINE_HEIGHT * scale,
                  background: UNDERLINE_COLOR,
                  transform: `scaleX(${underline})`,
                  transformOrigin: erase > 0 ? "right" : "left",
                }}
              />
            </p>
            <p
              className="font-normal leading-snug"
              style={{ fontSize: 26 * scale, color: DESCRIPTION_COLOR }}
            >
              {card.description}
            </p>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** The amber brand bar down the panel's left edge. Static. */
const AccentBar = ({ scale }: { scale: number }) => (
  <div
    className="absolute left-0 top-0 bottom-0"
    style={{ width: 8 * scale, background: "#FDE68A" }}
  />
);
