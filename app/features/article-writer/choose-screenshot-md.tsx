import { createContext, useContext, type HTMLAttributes } from "react";
import type { Options } from "react-markdown";
import { ChooseScreenshot } from "./choose-screenshot";
import type { IndexedClip, ScreenshotProposal } from "./types";

/** Everything a rendered ChooseScreenshot block needs from the writer. */
export interface ChooseScreenshotHost {
  clips: IndexedClip[];
  onClipIndexChange: (
    currentIndex: number,
    newIndex: number,
    alt: string
  ) => void;
  onCapture: (
    clipIndex: number,
    alt: string,
    timestamp: number,
    videoFilename: string
  ) => void;
  onRemove: (clipIndex: number, alt: string) => void;
  /** The block currently being captured, as `doc-<clipIndex>-<alt>`. */
  capturingKey: string | null;
  isStreaming: boolean;
  onFindScreenshot: (clipIndex: number, alt: string) => void;
  onDismissProposal: (clipIndex: number, alt: string) => void;
  proposalFor: (
    clipIndex: number,
    alt: string
  ) => ScreenshotProposal | undefined;
  isProposingFor: (clipIndex: number, alt: string) => boolean;
  selectionFor: (clipIndex: number, alt: string) => number | null;
  onSelectCandidate: (clipIndex: number, alt: string, index: number) => void;
}

const ChooseScreenshotContext = createContext<ChooseScreenshotHost | null>(
  null
);

export const ChooseScreenshotProvider = ChooseScreenshotContext.Provider;

/** The state key a ChooseScreenshot block is identified by. */
export const chooseScreenshotKey = (clipIndex: number, alt: string) =>
  `doc-${clipIndex}-${alt}`;

/**
 * The `<ChooseScreenshot>` tag, as react-markdown renders it.
 *
 * Defined once at module scope and fed through context rather than closed over
 * the writer's state, because react-markdown's `components` map is compared by
 * *identity*: a component built inside a `useMemo` is a new element type every
 * time one of that memo's dependencies changes, and React responds to a changed
 * type by unmounting the old tree and mounting a fresh one. That is what used
 * to throw away the scrubber position and the chosen candidate the instant a
 * proposal arrived — the very state change that was meant to be shown.
 *
 * Reading from context instead means the volatile values arrive as a re-render,
 * which preserves state, and leaves the map itself a module constant so the
 * whole document preview stops remounting on every keystroke too.
 */
function ChooseScreenshotBlock(
  compProps: HTMLAttributes<HTMLElement> & Record<string, unknown>
) {
  const host = useContext(ChooseScreenshotContext);
  if (!host) return null;

  const clipIndex = parseInt(compProps.clipindex as string, 10);
  const alt = (compProps.alt as string) ?? "";

  return (
    <ChooseScreenshot
      clipIndex={clipIndex}
      alt={alt}
      clips={host.clips}
      onClipIndexChange={(current, next) =>
        host.onClipIndexChange(current, next, alt)
      }
      onCapture={host.onCapture}
      onRemove={host.onRemove}
      isCapturing={host.capturingKey === chooseScreenshotKey(clipIndex, alt)}
      isStreaming={host.isStreaming}
      onFindScreenshot={host.onFindScreenshot}
      onDismissProposal={host.onDismissProposal}
      proposal={host.proposalFor(clipIndex, alt)}
      isProposing={host.isProposingFor(clipIndex, alt)}
      selectedCandidate={host.selectionFor(clipIndex, alt)}
      onSelectCandidate={(index) =>
        host.onSelectCandidate(clipIndex, alt, index)
      }
    />
  );
}

/**
 * The extra components the document preview renders. A module constant on
 * purpose — see `ChooseScreenshotBlock`.
 */
export const CHOOSE_SCREENSHOT_COMPONENTS = {
  choosescreenshot: ChooseScreenshotBlock as unknown,
} as Options["components"];
