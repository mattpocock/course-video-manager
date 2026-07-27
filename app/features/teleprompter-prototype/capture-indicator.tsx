/**
 * PROTOTYPE — throwaway.
 *
 * The icon-only twin of the editor's recording badge, so capture state is
 * readable from behind the lens without looking back at the main screen.
 *
 * Icons, colours and state names are copied verbatim from
 * `app/features/video-editor/components/live-media-stream.tsx` — if that badge
 * changes, this should change with it. Keeping them identical is the whole
 * point: you should not have to learn a second vocabulary while filming.
 */
import { CheckIcon, Loader2, MicIcon, MicOffIcon } from "lucide-react";
import type { CaptureStatus } from "@/lib/teleprompter-prototype-protocol";

const PRESENTATION: Record<
  CaptureStatus,
  { bg: string; icon: React.ReactNode; label: string }
> = {
  "not-recording": {
    bg: "bg-neutral-700",
    icon: <MicOffIcon className="size-7 text-white" />,
    label: "Not recording",
  },
  "warming-up": {
    bg: "bg-red-600",
    icon: <Loader2 className="size-7 animate-spin text-white" />,
    label: "Warming up",
  },
  "speaking-detected": {
    bg: "bg-yellow-600",
    icon: <MicIcon className="size-7 text-white" />,
    label: "Speaking",
  },
  "long-enough-speaking-for-clip-detected": {
    bg: "bg-green-600",
    icon: <MicIcon className="size-7 text-white" />,
    label: "Clip capturing",
  },
  silence: {
    bg: "bg-blue-600",
    icon: <CheckIcon className="size-7 text-white" />,
    label: "Silence — clip closed",
  },
};

export function CaptureIndicator(props: {
  status: CaptureStatus;
  /** Dimmed right down when the editor isn't reachable at all. */
  editorConnected: boolean;
}) {
  const presentation = PRESENTATION[props.status];

  return (
    <div
      className={`pointer-events-none absolute left-4 top-4 z-40 flex size-14 items-center justify-center rounded-full ${
        props.editorConnected ? presentation.bg : "bg-neutral-800"
      } ${props.editorConnected ? "" : "opacity-40"}`}
      title={
        props.editorConnected ? presentation.label : "Editor not connected"
      }
      aria-label={
        props.editorConnected ? presentation.label : "Editor not connected"
      }
    >
      {props.editorConnected ? (
        presentation.icon
      ) : (
        <MicOffIcon className="size-7 text-white/60" />
      )}
    </div>
  );
}
