import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/DMSans";
import { getIconNode } from "@cvm/lucide-icons";
import { type BulletPanel, type BulletPanelBullet } from "../src/props";
import {
  bulletPanelAnimationFrames,
  bulletPanelExitStartFrame,
  bulletPanelRampProgress,
} from "../src/bullet-panel-timing";

// DM Sans is AI Hero's brand typeface, the same one the Definition Card uses.
const { fontFamily } = loadFont();

/** The reference frame the panel's pixel sizes are authored against. */
const DESIGN_WIDTH = 1920;

/**
 * The panel is ALWAYS on the left. It is not a prop and not a stored field:
 * the paired camera Transform shifts the footage to the right by a fixed
 * amount, so a panel on the other side would sit on the presenter's face.
 */
const PANEL_LEFT = 96;
const PANEL_MAX_WIDTH = 620;

/** How far the panel travels as it arrives and leaves — a short lateral slide. */
const SLIDE_DISTANCE = 48;

/**
 * How far what the ground CARRIES slides, IN THE FRAME, and which way.
 *
 * The words and the mark hold almost still while the ground sweeps in from the
 * left and its leading edge wipes across them. This is the whole short move
 * they make of their own.
 *
 * The SIGN is the direction:
 *
 * - POSITIVE — they start to the right of where they finish and travel left,
 *   AGAINST the ground.
 * - NEGATIVE — they start to the left and travel right, WITH the ground, a
 *   long way behind it.
 *
 * Measured against the frame, not against the ground. The contents cancel the
 * ground's whole travel first (see `contentSlide`), so this is the entire
 * distance the eye sees them cover. A move stated against the ground instead
 * is swamped: a few dozen px inside an 812px sweep still reads as riding along
 * with it.
 *
 * TUNING: by eye, against the Studio. It went 72 -> 56 against the ground,
 * then over to -35 with it.
 */
const COUNTER_SLIDE_DISTANCE = -35;

/**
 * The dark ground the panel is read against, and how much of the frame it
 * covers.
 *
 * It covers the panel's OWN COLUMN and no more: the left gutter, the widest
 * line the panel can hold (the "allotted width" the four-bullet cap exists to
 * protect), then the same gutter again on its right. That is 812 of 1920 — the
 * left third-and-a-bit that the paired camera Transform clears — so the ground
 * ends where the footage the Transform kept begins, instead of dimming the
 * presenter.
 *
 * It is FULLY OPAQUE and its right edge is a clean cut: the panel is a surface
 * the footage runs beside, not a tint laid over it.
 *
 * The colour is tldraw's dark canvas, `hsl(240, 5%, 6.5%)`, the ground the
 * course diagrams are drawn on. A diagram and a Bullet Panel are the same
 * lesson's asides, so they share one background rather than each picking a
 * near-black of its own.
 */
const GROUND_WIDTH = PANEL_LEFT + PANEL_MAX_WIDTH + PANEL_LEFT;
const GROUND_COLOR = "#101011";

/**
 * The brand mark in the panel's top-left corner, on the same gutter as the
 * words below it, so the corner margin is square.
 *
 * It is the WHITE mark — the same one the Definition Card now takes, since
 * both panels sit on the same dark ground.
 */
const LOGO_SIZE = 56;

/**
 * A bullet's own type metrics, named because the ICON is aligned against them.
 *
 * The glyph is centred inside a box exactly one line tall, so it sits on the
 * middle of the FIRST line whether the text runs to one line or three.
 * Aligning the icon's top edge to the text's instead floats it above the
 * letters, because a line box is taller than the letters inside it.
 */
const BULLET_FONT_SIZE = 32;
const BULLET_LINE_HEIGHT = 1.45;
const BULLET_ICON_SIZE = 30;

/**
 * Stone-300: the bullets sit one step back from the title's white. On a dark
 * ground, pure white on every line glares and flattens the panel — the heading
 * should still lead the eye.
 */
const BULLET_TEXT_COLOR = "#D6D3D1";

/**
 * The panel carries NO accent bar and no colour of its own.
 *
 * The Definition Card carries an amber accent bar because it is a small card
 * that needs one visual anchor; this panel is a dark surface the size of a
 * third of frame, and the only things on it are the AI Hero mark, a heading
 * and its bullets. Weight and space separate them, not colour.
 */

/**
 * The icons are drawn in the same white as the text they label. They are
 * punctuation for the line, not a second accent competing with the title's
 * bar for the eye.
 */
const ICON_COLOR = "#FFFFFF";

/**
 * The shared easing curve. The subtitles rise on it and the camera Transform
 * pans on it, so the panel, the words and the framing all accelerate alike.
 */
const EASE = Easing.bezier(0.25, 0.1, 0.25, 1);

/**
 * Bullet Panels: a heading plus up to four icon bullets down the LEFT of frame,
 * shown while the camera Transform holds the footage over to the right.
 *
 * Each bullet arrives at its OWN authored `revealAt`, so the list keeps pace
 * with the narration instead of landing in one generic wave. The panel LEAVES
 * in a single un-staggered movement — a four-bullet exit takes exactly as long
 * as a one-bullet exit, which is what stops a long panel dribbling off screen.
 */
export const BulletPanels = ({ panels }: { panels: BulletPanel[] }) => (
  <>
    {panels.map((panel, index) => (
      <Sequence
        key={index}
        from={panel.startFrame}
        // Remotion requires a positive duration; a zero-length panel would
        // otherwise throw rather than simply not being seen.
        durationInFrames={Math.max(1, panel.durationInFrames)}
      >
        <Panel panel={panel} />
      </Sequence>
    ))}
  </>
);

/**
 * 0 -> 1 over `duration` frames from `startFrame`, on the shared curve.
 *
 * WHEN it moves is `bulletPanelRampProgress`'s business (pure, and tested
 * without a render); HOW it moves is this file's. An instant ramp is not
 * eased at all — it is already at one end or the other.
 */
const ramp = (
  frame: number,
  startFrame: number,
  duration: number,
  instant: boolean
): number => {
  const progress = bulletPanelRampProgress({
    frame,
    startFrame,
    duration,
    instant,
  });
  if (instant) return progress;
  return interpolate(progress, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE,
  });
};

const Panel = ({ panel }: { panel: BulletPanel }) => {
  const frame = useCurrentFrame();
  const { width, fps } = useVideoConfig();
  const scale = width / DESIGN_WIDTH;
  const duration = Math.max(1, panel.durationInFrames);
  const animationFrames = bulletPanelAnimationFrames(fps);

  // The exit is the whole panel's, so it lives on the outermost element and
  // covers the title and every bullet at once, whatever each one is doing. A
  // disabled exit fires at the window's END rather than one ease before it, so
  // the panel leaves on the same frame the camera does — see
  // `bulletPanelExitStartFrame`.
  const exit = ramp(
    frame,
    bulletPanelExitStartFrame({
      durationInFrames: duration,
      animationFrames,
      disableExitAnimation: panel.disableExitAnimation,
    }),
    animationFrames,
    panel.disableExitAnimation
  );
  const enter = ramp(frame, 0, animationFrames, panel.disableEnterAnimation);

  // -1 off frame, 0 in place, back to -1 on the way out. ONE number for the
  // whole panel's position, so the surface and what it carries cannot fall out
  // of step.
  const slide = enter - 1 - exit;

  // The ground's own travel: its whole width, in from off the left edge.
  const groundSlide = slide * GROUND_WIDTH * scale;

  // What it carries, in the ground's coordinates. It UNDOES the ground's
  // travel — so the words stay where they are in the frame and the surface
  // wipes across them — and then adds its own short move the OTHER way. Both
  // terms come off `slide`, so the two can only ever oppose.
  const contentSlide = -groundSlide - slide * COUNTER_SLIDE_DISTANCE * scale;

  return (
    <AbsoluteFill style={{ fontFamily }}>
      {/*
        ONE surface, arriving as one thing — the ground's whole width, in from
        off the left edge of frame and out the same way, at full opacity
        throughout. Nothing on the panel fades in on its own account, so
        nothing appears while the panel is still arriving.

        The words and the mark do NOT ride the surface. They hold their place
        in the frame while the ground's leading edge wipes across them, and
        they move a short way of their own — the OTHER way, against the
        ground. See `COUNTER_SLIDE_DISTANCE`.

        The ground CLIPS what it carries. The words are already in their final
        places when the panel is still off frame, and the ground's leading edge
        wipes across them as it comes: the title is revealed by the surface
        arriving, rather than fading up on top of it. Clipping is also what
        keeps a long line inside the dark column instead of hanging over the
        footage.
      */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: GROUND_WIDTH * scale,
          background: GROUND_COLOR,
          overflow: "hidden",
          transform: `translateX(${groundSlide}px)`,
        }}
      >
        {/*
          Everything the ground carries, counter-sliding as ONE piece — the
          mark, the title and the bullets with their icons. Held on a single
          wrapper rather than repeated on each of them, so no part of the panel
          can drift against another part.
        */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transform: `translateX(${contentSlide}px)`,
          }}
        >
          <Img
            src={staticFile("/ai-hero-logo.svg")}
            style={{
              position: "absolute",
              top: PANEL_LEFT * scale,
              left: PANEL_LEFT * scale,
              width: LOGO_SIZE * scale,
              height: LOGO_SIZE * scale,
            }}
          />

          <div
            className="absolute inset-0 flex flex-col justify-center items-start"
            style={{
              paddingLeft: PANEL_LEFT * scale,
              paddingRight: PANEL_LEFT * scale,
            }}
          >
            <div
              className="flex flex-col"
              style={{
                maxWidth: PANEL_MAX_WIDTH * scale,
                gap: 44 * scale,
              }}
            >
              {/* No accent bar, and no entrance of its own. The title starts on
                the panel's own left edge, the same vertical the icons below it
                start on, so ONE left edge runs down the whole panel. */}
              <p
                className="font-bold leading-tight text-white"
                style={{ fontSize: 44 * scale }}
              >
                {panel.title}
              </p>

              <div className="flex flex-col" style={{ gap: 36 * scale }}>
                {panel.bullets.map((bullet, index) => (
                  <Bullet
                    key={index}
                    bullet={bullet}
                    scale={scale}
                    // Its own reveal, from its own authored second — the ONE
                    // thing on the panel that still animates separately, because
                    // a staggered list is what a Bullet Panel is for. The
                    // Sequence already starts where the Overlay does, so
                    // `revealAt` needs nothing but a multiplication by the frame
                    // rate.
                    revealFrame={bullet.revealAt * fps}
                    animationFrames={animationFrames}
                    // A bullet authored at ZERO has nothing to ease in from.
                    // It is spoken as the Overlay opens, so it belongs to the
                    // panel's ARRIVAL: it is already in place when the ground
                    // wipes past, with the title. Easing it in on top of that
                    // is the second animation this panel is meant not to have.
                    instant={
                      panel.disableEnterAnimation || bullet.revealAt === 0
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Bullet = ({
  bullet,
  scale,
  revealFrame,
  animationFrames,
  instant,
}: {
  bullet: BulletPanelBullet;
  scale: number;
  revealFrame: number;
  animationFrames: number;
  instant: boolean;
}) => {
  const frame = useCurrentFrame();
  const reveal = ramp(frame, revealFrame, animationFrames, instant);

  return (
    <div
      className="flex items-start"
      style={{
        gap: 18 * scale,
        opacity: reveal,
        transform: `translateX(${(reveal - 1) * SLIDE_DISTANCE * scale}px)`,
      }}
    >
      {/* One line tall, and the glyph centred in it — see the metrics above. */}
      <div
        className="flex items-center"
        style={{
          height: BULLET_FONT_SIZE * BULLET_LINE_HEIGHT * scale,
          flexShrink: 0,
        }}
      >
        <IconGlyph name={bullet.icon} size={BULLET_ICON_SIZE * scale} />
      </div>
      <p
        className="font-normal"
        style={{
          fontSize: BULLET_FONT_SIZE * scale,
          // Stated rather than left to a utility class, because the icon's box
          // is measured from it: the two must not drift apart.
          lineHeight: BULLET_LINE_HEIGHT,
          color: BULLET_TEXT_COLOR,
        }}
      >
        {bullet.text}
      </p>
    </div>
  );
};

/**
 * A lucide icon as an inline SVG, drawn straight from the vendored icon-node
 * table (`@cvm/lucide-icons`) — the same frozen data the diagram palette draws
 * from. Vector, so it stays crisp at any export resolution, and no
 * `lucide-react` dependency is added to this package for it.
 *
 * An unknown name draws nothing rather than throwing: by the time a name
 * reaches a render it has already been validated at authoring time, so a miss
 * here means the table moved under a stored name, and losing one glyph is
 * cheaper than losing the export.
 */
const IconGlyph = ({ name, size }: { name: string; size: number }) => {
  const node = getIconNode(name);
  if (!node) return null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={ICON_COLOR}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      {node.map(([tag, attrs], index) => {
        // lucide's own vocabulary maps 1:1 onto SVG elements and its attribute
        // names are already SVG's, so they pass straight through.
        const Tag = tag as "path";
        return (
          <Tag key={index} {...(attrs as Record<string, string | number>)} />
        );
      })}
    </svg>
  );
};
