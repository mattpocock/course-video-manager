import { useEffect, useRef, type RefObject } from "react";
import {
  CHOOSE_SCREENSHOT_ATTR,
  SCREENSHOT_CAPTURE_EVENT,
  SCREENSHOT_FACE_EVENT,
  SCREENSHOT_STEP_EVENT,
  isScreenshotCapturePress,
  isScreenshotFacePress,
  pickCurrentScreenshot,
  pickScreenshotTarget,
  screenshotNavDirection,
  screenshotStep,
  type ScreenshotCaptureRequest,
} from "./screenshot-navigation";
import { after } from "@/packages/clock";

const HIGHLIGHT_CLASSES = ["ring-2", "ring-primary", "ring-offset-2"];
const HIGHLIGHT_MS = 1200;

/**
 * L / K step through the preview's `<ChooseScreenshot>` placeholders; I / O and
 * Left / Right nudge the current one's frame; P cycles its face; Return captures it and, once the
 * capture has succeeded, walks on as L would. Mount it only while the preview
 * is showing.
 *
 * Scoped to keys pressed inside the dialog that holds the preview. The Video
 * page's own L / K (2x / 1x) and the Animatic page's both refuse any key from
 * inside a dialog, so exactly one handler ever acts on a press.
 */
export function useScreenshotNavigation(
  previewRef: RefObject<HTMLElement | null>,
  enabled: boolean
) {
  const lastVisited = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    lastVisited.current = null;

    const placeholdersIn = (preview: HTMLElement) =>
      Array.from(
        preview.querySelectorAll<HTMLElement>(`[${CHOOSE_SCREENSHOT_ATTR}]`)
      );

    const goTo = (el: HTMLElement, index: number) => {
      lastVisited.current = index;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add(...HIGHLIGHT_CLASSES);
      after(HIGHLIGHT_MS, () => el.classList.remove(...HIGHLIGHT_CLASSES));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const preview = previewRef.current;
      if (!preview) return;
      const direction = screenshotNavDirection(e);
      const step = screenshotStep(e);
      const capture = isScreenshotCapturePress(e, preview);
      const face = isScreenshotFacePress(e);
      if (direction === null && step === null && !capture && !face) return;

      const scope = preview.closest('[role="dialog"]') ?? document.body;
      if (!(e.target instanceof Node) || !scope.contains(e.target)) return;

      const placeholders = placeholdersIn(preview);
      if (placeholders.length === 0) return;
      e.preventDefault();

      const box = preview.getBoundingClientRect();
      const spans = placeholders.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top - box.top, bottom: r.bottom - box.top };
      });
      const viewportHeight = preview.clientHeight;

      if (step !== null || capture || face) {
        const current = pickCurrentScreenshot({
          spans,
          viewportHeight,
          lastVisited: lastVisited.current,
        });
        if (current === null) return;
        const el = placeholders[current]!;
        if (step !== null) {
          el.dispatchEvent(
            new CustomEvent(SCREENSHOT_STEP_EVENT, { detail: step })
          );
          return;
        }
        if (face) {
          el.dispatchEvent(new CustomEvent(SCREENSHOT_FACE_EVENT));
          return;
        }

        // Where L would go from here, decided now: the capture replaces this
        // placeholder with an image, shifting every later one up an index.
        const next = pickScreenshotTarget({
          spans,
          viewportHeight,
          lastVisited: current,
          direction: 1,
        });
        const nextEl = next === null ? null : placeholders[next]!;
        const request: ScreenshotCaptureRequest = {
          onCaptured: () => {
            if (!nextEl) return; // The last one: capture and stay.
            // Two frames: let React commit the captured document first.
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const now = placeholdersIn(preview);
                const found = now.indexOf(nextEl);
                const index = found === -1 ? current : found;
                const target = now[index];
                if (target) goTo(target, index);
              })
            );
          },
        };
        el.dispatchEvent(
          new CustomEvent(SCREENSHOT_CAPTURE_EVENT, { detail: request })
        );
        return;
      }
      if (direction === null) return;

      const target = pickScreenshotTarget({
        spans,
        viewportHeight,
        lastVisited: lastVisited.current,
        direction,
      });
      if (target === null) return;
      goTo(placeholders[target]!, target);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewRef, enabled]);
}
