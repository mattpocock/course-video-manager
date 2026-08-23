import { Composition } from "remotion";
import { Overlay } from "./Composition";
import "./index.css";
import { COMPOSITION_ID, type OverlayProps } from "../src/props";

// Sample props so Remotion Studio (`pnpm run studio`) has something to show. The
// real render always supplies its own props via `inputProps`.
const sampleProps: OverlayProps = {
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
  definitionCards: [
    {
      title: "Ubiquitous Language",
      description:
        "One shared vocabulary for a domain, used identically in conversation and in code.",
      startFrame: 0,
      durationInFrames: 180,
    },
  ],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={Overlay}
      defaultProps={sampleProps}
      calculateMetadata={async ({ props }) => ({
        durationInFrames: Math.floor(props.durationInFrames),
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
      // Overridden per-render by calculateMetadata; required by the type.
      durationInFrames={sampleProps.durationInFrames}
      fps={sampleProps.fps}
      width={sampleProps.width}
      height={sampleProps.height}
    />
  );
};
