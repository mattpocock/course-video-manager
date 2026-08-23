import { Composition } from "remotion";
import { Overlay } from "./Composition";
import "./index.css";
import { COMPOSITION_ID, type OverlayProps } from "../src/props";

// Sample props so Remotion Studio (`pnpm run studio`) has something to show. The
// real render always supplies its own props via `inputProps`.

/** The vertical Shorts pipeline: subtitles + CTA. */
const shortsSampleProps: OverlayProps = {
  width: 1080,
  height: 1920,
  fps: 60,
  durationInFrames: 180,
  subtitles: [
    { startFrame: 0, endFrame: 60, text: "There's an idea floating around" },
    { startFrame: 60, endFrame: 120, text: "that I think is mostly rubbish," },
    { startFrame: 120, endFrame: 180, text: "that AI can only be" },
  ],
  cta: { variant: "ai", durationInFrames: 120 },
  definitionCards: [],
  bulletPanels: [],
};

/**
 * The landscape course-video pipeline: one Definition Card, alone, for the
 * length of its own overlay clip. Uses the same `Overlay` component as the
 * render, so the Studio shows exactly what the renderer draws.
 */
const definitionCardSampleProps: OverlayProps = {
  width: 1920,
  height: 1080,
  fps: 60,
  durationInFrames: 180,
  subtitles: [],
  cta: null,
  definitionCards: [
    {
      title: "Ubiquitous Language",
      description:
        "One shared vocabulary for a domain, used identically in conversation and in code.",
      startFrame: 0,
      durationInFrames: 180,
    },
  ],
  bulletPanels: [],
};

/**
 * The landscape course-video pipeline again, this time a Bullet Panel: the
 * bullets arrive one at a time on their own authored seconds, and the whole
 * panel leaves together.
 */
const bulletPanelSampleProps: OverlayProps = {
  width: 1920,
  height: 1080,
  fps: 60,
  durationInFrames: 300,
  subtitles: [],
  cta: null,
  definitionCards: [],
  bulletPanels: [
    {
      title: "What a spec has to answer",
      bullets: [
        { icon: "target", text: "The problem, in one paragraph", revealAt: 0 },
        { icon: "route", text: "The decisions already made", revealAt: 1.2 },
        { icon: "flask-conical", text: "How it will be tested", revealAt: 2.4 },
        { icon: "scissors", text: "What is out of scope", revealAt: 3.6 },
      ],
      startFrame: 0,
      durationInFrames: 300,
      disableEnterAnimation: false,
      disableExitAnimation: false,
    },
  ],
};

const metadata = async ({ props }: { props: OverlayProps }) => ({
  durationInFrames: Math.floor(props.durationInFrames),
  fps: props.fps,
  width: props.width,
  height: props.height,
});

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id={COMPOSITION_ID}
        component={Overlay}
        defaultProps={shortsSampleProps}
        calculateMetadata={metadata}
        // Overridden per-render by calculateMetadata; required by the type.
        durationInFrames={shortsSampleProps.durationInFrames}
        fps={shortsSampleProps.fps}
        width={shortsSampleProps.width}
        height={shortsSampleProps.height}
      />
      {/* Studio-only previews. The render always selects COMPOSITION_ID. */}
      <Composition
        id="DefinitionCard"
        component={Overlay}
        defaultProps={definitionCardSampleProps}
        calculateMetadata={metadata}
        durationInFrames={definitionCardSampleProps.durationInFrames}
        fps={definitionCardSampleProps.fps}
        width={definitionCardSampleProps.width}
        height={definitionCardSampleProps.height}
      />
      <Composition
        id="BulletPanel"
        component={Overlay}
        defaultProps={bulletPanelSampleProps}
        calculateMetadata={metadata}
        durationInFrames={bulletPanelSampleProps.durationInFrames}
        fps={bulletPanelSampleProps.fps}
        width={bulletPanelSampleProps.width}
        height={bulletPanelSampleProps.height}
      />
    </>
  );
};
