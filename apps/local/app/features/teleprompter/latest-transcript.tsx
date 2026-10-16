/**
 * The transcript of the clip you just recorded, top right of the glass.
 *
 * For reading back a take you got wrong: the words that actually came out,
 * next to the words you meant to say. The editor picks the clip (see
 * `session-latest-transcript.ts`) — the newest transcribed one in this
 * recording session, deleted ones included — and this only draws it. Not
 * drawn over a suggestion, whose glass already shows the last Clips.
 *
 * Small and dim, for the same reason the controls are: anything bright on the
 * glass is something you read around for the whole take. Never truncated: the
 * whole take wraps onto as many lines as it needs, and only a take taller than
 * the glass (less the controls strip at the bottom) scrolls inside the panel.
 */
import { TYPE } from "./teleprompter-settings";

export function LatestTranscript(props: { text: string | null }) {
  if (!props.text) return null;

  return (
    <div
      className="absolute right-4 top-4 z-40 max-h-[calc(100vh-6rem)] w-80 select-none overflow-y-auto rounded-lg border border-white/10 bg-neutral-950/80 px-3 py-2"
      aria-label="Latest clip transcript"
    >
      <p
        className="whitespace-pre-wrap break-words text-sm leading-snug text-white/60"
        style={{ fontFamily: TYPE.fontFamily }}
      >
        {props.text}
      </p>
    </div>
  );
}
