import { useLayoutEffect, useRef, useState } from "react";
import { toast as sonnerToast, type ExternalToast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * The app's one way to show a toast. A thin layer over sonner's `toast` that
 * bounds every toast, whatever text a call site hands it:
 *
 * - A string title or description is clamped to four lines, with a
 *   "Show more" toggle when it overflows. Expanded, it scrolls inside the
 *   toast rather than growing past the screen.
 * - An error toast gets a "Copy" action that copies its full text, so an
 *   enormous error can be pasted somewhere useful instead of read on screen.
 *
 * `<Toaster>` (./sonner.tsx) adds the floor beneath this: long unbroken
 * strings wrap, and no title or description outgrows half the viewport.
 *
 * Import `toast` from here, never from "sonner" — the `sonner` entry of
 * `no-restricted-imports` in `.oxlintrc.json` holds that line.
 */

type Title = Parameters<typeof sonnerToast>[0];
type Show = (message: Title, data?: ExternalToast) => string | number;

interface ToastTextProps {
  text: string;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * A toast's title or description: four lines, then "Show more". Whether it is
 * expanded lives in the toast itself, not in this component — sonner fixes a
 * toast's height when it is shown and only measures it again when the toast is
 * updated, so the toggle re-issues the toast (see `bounded`) to make it grow.
 */
export function ToastText({ text, expanded, onToggle }: ToastTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);

  return (
    <div className="min-w-0">
      <div
        ref={ref}
        className={cn(
          "whitespace-pre-wrap [overflow-wrap:anywhere]",
          expanded ? "max-h-[40vh] overflow-y-auto pr-1" : "line-clamp-4"
        )}
      >
        {text}
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          className="mt-1 text-xs font-medium underline underline-offset-2 opacity-80 hover:opacity-100"
          onClick={onToggle}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

let nextToastId = 0;

/**
 * Wrap one of sonner's `toast` variants so string text renders through
 * `ToastText`. The toast gets an id up front so "Show more" can re-issue it,
 * expanded, in place.
 */
const bounded =
  (show: Show): Show =>
  (message, data) => {
    const id = data?.id ?? `bounded-toast-${++nextToastId}`;
    const render = (expanded: boolean): string | number => {
      const onToggle = () => render(!expanded);
      const asText = (text: string) => (
        <ToastText text={text} expanded={expanded} onToggle={onToggle} />
      );
      return show(typeof message === "string" ? asText(message) : message, {
        ...data,
        id,
        description:
          typeof data?.description === "string"
            ? asText(data.description)
            : data?.description,
      });
    };
    return render(false);
  };

/** The toast's own text, as the caller wrote it — what "Copy" puts on the clipboard. */
const plainText = (message: Title, data: ExternalToast | undefined) =>
  [message, data?.description]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join("\n\n");

const withCopyAction = (
  message: Title,
  data: ExternalToast | undefined
): ExternalToast | undefined => {
  const text = plainText(message, data);
  if (data?.action || text === "") return data;
  return {
    ...data,
    action: {
      label: "Copy",
      onClick: (event) => {
        // Keep the toast open: the user may still be reading it.
        event.preventDefault();
        navigator.clipboard.writeText(text).then(
          () => toast.success("Error copied to clipboard"),
          () => toast.error("Failed to copy error to clipboard")
        );
      },
    },
  };
};

const boundedError = bounded(sonnerToast.error);
const errorWithCopy: Show = (message, data) =>
  boundedError(message, withCopyAction(message, data));

export const toast = Object.assign(bounded(sonnerToast), {
  success: bounded(sonnerToast.success),
  info: bounded(sonnerToast.info),
  warning: bounded(sonnerToast.warning),
  error: errorWithCopy,
  message: bounded(sonnerToast.message),
  loading: bounded(sonnerToast.loading),
  promise: sonnerToast.promise,
  custom: sonnerToast.custom,
  dismiss: sonnerToast.dismiss,
  getHistory: sonnerToast.getHistory,
  getToasts: sonnerToast.getToasts,
});

/**
 * Show a caught error: its message when it is an `Error` (or a non-empty
 * string), otherwise `fallback`. Never the stack — the clamp and "Copy" make
 * a long message safe, but a stack is noise in a toast.
 */
export function toastError(error: unknown, fallback: string): string | number {
  const message =
    error instanceof Error && error.message !== ""
      ? error.message
      : typeof error === "string" && error !== ""
        ? error
        : fallback;
  return toast.error(message);
}
