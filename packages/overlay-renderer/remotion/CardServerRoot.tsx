import { Composition } from "remotion";
import {
  ChatHighlightCard,
  type ChatHighlightCardProps,
} from "./ChatHighlightCard";
import "./index.css";
import {
  CHAT_HIGHLIGHT_COMPOSITION_ID,
  chatHighlightCanvasSize,
} from "../src/chat-highlight-card";

/**
 * The card server's own Remotion root, separate from the Overlay root.
 *
 * It holds only the Chat Highlight card, so nothing in this bundle loads a
 * font from Google: the Overlay root's components fetch theirs from the
 * network when the bundle loads, and the card server must render offline.
 */

/** Sample props so `pnpm run studio:card` has something to show. */
const sampleProps: ChatHighlightCardProps = {
  author: "@fake_viewer_42",
  text: "Do you write the tests before the types, or the types before the tests?",
  frameWidth: 1920,
};

const metadata = async ({ props }: { props: ChatHighlightCardProps }) => ({
  ...chatHighlightCanvasSize(props.frameWidth),
  durationInFrames: 1,
  fps: 60,
});

export const CardServerRoot: React.FC = () => (
  <Composition
    id={CHAT_HIGHLIGHT_COMPOSITION_ID}
    component={ChatHighlightCard}
    defaultProps={sampleProps}
    calculateMetadata={metadata}
    // Overridden by calculateMetadata; required by the type.
    durationInFrames={1}
    fps={60}
    {...chatHighlightCanvasSize(sampleProps.frameWidth)}
  />
);
