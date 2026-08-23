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
 * It is the WHITE mark. The Definition Card takes the dark one because its
 * card is white; this panel's ground is not.
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

/** Amber-200, the same brand amber the Definition Card's accent bar uses. */
const ACCENT_COLOR = "#FDE68A";

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

  return (
    <>
      {/*
        The ground and its mark are ONE surface, and a SIBLING of the words
        rather than their parent. It travels its own full width, so it enters
        from off the left edge of frame and leaves the same way, at FULL
        OPACITY throughout: the panel is a surface that moved into place, never
        one that faded up. The words then slide their own short distance on top
        of it.
      */}
      <AbsoluteFill
        style={{
          transform: `translateX(${(enter - 1 - exit) * GROUND_WIDTH * scale}px)`,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: GROUND_WIDTH * scale,
            background: GROUND_COLOR,
          }}
        />
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
      </AbsoluteFill>

      <AbsoluteFill
        className="flex flex-col justify-center items-start"
        style={{
          fontFamily,
          paddingLeft: PANEL_LEFT * scale,
          opacity: 1 - exit,
          transform: `translateX(${-exit * SLIDE_DISTANCE * scale}px)`,
        }}
      >
        <div
          className="flex flex-col"
          style={{
            maxWidth: PANEL_MAX_WIDTH * scale,
            gap: 44 * scale,
          }}
        >
          <div
            className="flex items-center"
            style={{
              gap: 20 * scale,
              opacity: enter,
              transform: `translateX(${(enter - 1) * SLIDE_DISTANCE * scale}px)`,
            }}
          >
            <div
              style={{
                width: 8 * scale,
                height: 44 * scale,
                borderRadius: 8 * scale,
                background: ACCENT_COLOR,
                flexShrink: 0,
              }}
            />
            <p
              className="font-bold leading-tight text-white"
              style={{ fontSize: 44 * scale }}
            >
              {panel.title}
            </p>
          </div>

          <div className="flex flex-col" style={{ gap: 36 * scale }}>
            {panel.bullets.map((bullet, index) => (
              <Bullet
                key={index}
                bullet={bullet}
                scale={scale}
                // Its own reveal, from its own authored second. The Sequence
                // already starts where the Overlay does, so `revealAt` needs
                // nothing but a multiplication by the frame rate.
                revealFrame={bullet.revealAt * fps}
                animationFrames={animationFrames}
                instant={panel.disableEnterAnimation}
              />
            ))}
          </div>
        </div>
      </AbsoluteFill>
    </>
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
