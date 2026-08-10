"use client";

import { createContext, useContext } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import type { Options } from "react-markdown";
import { ChooseScreenshot } from "./choose-screenshot";
import type { IndexedClip } from "./types";

/**
 * Everything a rendered `<ChooseScreenshot>` placeholder needs. It travels by
 * context rather than by closure so the component map below can stay frozen —
 * see {@link CHOOSE_SCREENSHOT_COMPONENTS} for why that matters.
 */
export interface ChooseScreenshotRuntime {
  clips: IndexedClip[];
  /** True while the writer is still producing text; placeholders wait. */
  isStreaming: boolean;
  /** Identifies the one placeholder whose capture is in flight, if any. */
  capturingKey: string | null;
  /**
   * Builds the key compared against `capturingKey`. The chat scopes keys by
   * message id; the document has one scope and ignores it.
   */
  keyFor: (clipIndex: number, alt: string, messageId: string) => string;
  onClipIndexChange: (
    messageId: string,
    currentIndex: number,
    newIndex: number,
    alt: string
  ) => void;
  onCapture: (
    messageId: string,
    clipIndex: number,
    alt: string,
    timestamp: number,
    videoFilename: string
  ) => void;
  onRemove: (messageId: string, clipIndex: number, alt: string) => void;
}

const RuntimeContext = createContext<ChooseScreenshotRuntime | null>(null);

/** Wrap whatever renders the markdown; without it placeholders render nothing. */
export function ChooseScreenshotProvider({
  runtime,
  children,
}: {
  runtime: ChooseScreenshotRuntime;
  children: ReactNode;
}) {
  return (
    <RuntimeContext.Provider value={runtime}>
      {children}
    </RuntimeContext.Provider>
  );
}

function ChooseScreenshotSlot(
  props: HTMLAttributes<HTMLElement> & Record<string, unknown>
) {
  const runtime = useContext(RuntimeContext);
  if (!runtime) return null;

  const clipIndex = parseInt(props.clipindex as string, 10);
  const alt = (props.alt as string) ?? "";
  const messageId = (props["data-message-id"] as string) ?? "";

  return (
    <ChooseScreenshot
      clipIndex={clipIndex}
      alt={alt}
      clips={runtime.clips}
      onClipIndexChange={(current, next) =>
        runtime.onClipIndexChange(messageId, current, next, alt)
      }
      onCapture={(ci, a, timestamp, videoFilename) =>
        runtime.onCapture(messageId, ci, a, timestamp, videoFilename)
      }
      onRemove={(ci, a) => runtime.onRemove(messageId, ci, a)}
      isCapturing={
        runtime.capturingKey === runtime.keyFor(clipIndex, alt, messageId)
      }
      isStreaming={runtime.isStreaming}
    />
  );
}

/**
 * The tag → component map handed to `AIResponse`. A module constant, and it
 * must stay one.
 *
 * react-markdown uses the mapped value as the React element *type*
 * (`hast-util-to-jsx-runtime`), so handing it a fresh arrow function is not a
 * re-render — React unmounts every rendered placeholder and mounts a new one,
 * throwing away each `<video>` and the button under the user's cursor. Building
 * this map inside a `useMemo` keyed on capture state did exactly that, twice
 * per capture (once when the spinner went on, once when it came off).
 *
 * Everything that changes reaches the placeholder through
 * {@link ChooseScreenshotProvider} instead. Context updates propagate through
 * `AIResponse`'s `memo`, so the spinner still appears without the map moving.
 */
export const CHOOSE_SCREENSHOT_COMPONENTS = {
  choosescreenshot: ChooseScreenshotSlot as unknown,
} as Options["components"];
