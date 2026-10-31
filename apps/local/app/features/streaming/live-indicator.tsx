import { Link } from "react-router";
import { RadioIcon } from "lucide-react";
import { useLiveStream } from "./live-stream-context";
import { liveIndicator } from "./live-stream-reducer";

/**
 * The Live indicator, on every page while live (ADR 0055): a link back to
 * the Streaming tab of the Video that is live. The Live Stream surface
 * hears the app server's word on it as it changes (`live-stream-wire.ts`),
 * so it goes when a Live Stream ends on its own, and decides what shows.
 */
export const LiveIndicator = () => {
  const { state } = useLiveStream();

  const indicator = liveIndicator(state);
  if (!indicator) return null;
  return (
    <Link
      to={indicator.href}
      data-testid="live-indicator"
      className="flex items-center gap-2 border-b border-red-500/40 bg-red-500/15 px-4 py-1.5 text-sm font-medium text-red-600 hover:bg-red-500/25"
    >
      <RadioIcon className="size-4" />
      <span>{indicator.words}</span>
      <span className="text-muted-foreground font-normal">
        Back to the Streaming tab
      </span>
    </Link>
  );
};
