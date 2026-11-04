import { useEffect } from "react";
import { useLocation } from "react-router";
import {
  AlertTriangleIcon,
  CheckIcon,
  RefreshCwIcon,
  YoutubeIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  broadcastPickerRows,
  broadcastPickerView,
} from "./live-stream-reducer";
import { useLiveStream } from "./live-stream-context";
import {
  broadcastSettingsWords,
  type Broadcast,
  type ReconnectReason,
} from "./broadcast";
import { NewBroadcastButton, NewBroadcastForm } from "./new-broadcast-form";
import type { NewBroadcastVideo } from "./new-stream-video";
import { useNewBroadcastReducer } from "./use-new-broadcast-reducer";

const RECONNECT_MESSAGES: Record<ReconnectReason, string> = {
  "not-connected": "Connect Google to list your YouTube Broadcasts.",
  "missing-live-access":
    "Google needs reconnecting: your connection predates live-streaming access, so CVM can't list your Broadcasts. Uploads keep working either way.",
};

const formatScheduledStart = (iso: string | null) =>
  iso === null
    ? "No scheduled start"
    : new Date(iso).toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });

/** A Broadcast's scheduled start, privacy and latency, on one line. */
const broadcastDetails = (broadcast: Broadcast) =>
  [
    formatScheduledStart(broadcast.scheduledStartTime),
    broadcastSettingsWords(broadcast),
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * The Streaming tab's Broadcast picker: Matt's active and upcoming YouTube
 * Broadcasts, a Refresh, and a reconnect prompt when Google's grant lacks
 * live-streaming access. The pick lives in the app-wide Live Stream surface.
 * Once a Broadcast is picked, only the pick shows, with Change to bring the
 * list back (`broadcastPickerView`), so the chat below gets the room.
 * New Broadcast sits beside it either way: its form outlives the switch
 * from the list to the pick it makes.
 */
export const BroadcastPicker = (props: {
  /** The Video the Streaming tab is open for: New Broadcast's defaults. */
  video: NewBroadcastVideo;
}) => {
  const { state, dispatch } = useLiveStream();
  const location = useLocation();
  const [newBroadcast, newBroadcastDispatch] = useNewBroadcastReducer(
    props.video,
    dispatch
  );
  const newBroadcastForm = (
    <NewBroadcastForm state={newBroadcast} dispatch={newBroadcastDispatch} />
  );

  // Bridges the picker appearing to the surface, which decides whether to list.
  useEffect(() => {
    dispatch({ type: "broadcast-picker-shown" });
  }, [dispatch]);

  const view = broadcastPickerView(state);
  if (view.kind === "picked") {
    return (
      <div className="flex flex-col gap-1" data-testid="broadcast-picker">
        <div className="flex items-center gap-2">
          <YoutubeIcon className="size-4 shrink-0 text-red-500" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {view.broadcast.title}
            </p>
            <p className="text-xs text-muted-foreground">
              {broadcastDetails(view.broadcast)}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <NewBroadcastButton dispatch={newBroadcastDispatch} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch({ type: "change-broadcast-clicked" })}
            >
              Change
            </Button>
          </div>
        </div>
        {view.refusal !== null && (
          <div className="flex gap-1 text-xs text-amber-600">
            <AlertTriangleIcon className="size-3.5 shrink-0 mt-0.5" />
            <span>{view.refusal}</span>
          </div>
        )}
        {newBroadcastForm}
      </div>
    );
  }

  const list = state.broadcastList;
  const rows = broadcastPickerRows(state);

  return (
    <div className="flex flex-col gap-2 min-h-0" data-testid="broadcast-picker">
      <div className="flex items-center gap-2">
        <YoutubeIcon className="size-4 text-red-500" />
        <h2 className="text-sm font-medium">Broadcast</h2>
        <div className="ml-auto" />
        <NewBroadcastButton dispatch={newBroadcastDispatch} />
        <Button
          variant="ghost"
          size="sm"
          disabled={state.listing}
          onClick={() => dispatch({ type: "refresh-broadcasts-clicked" })}
          aria-label="Refresh Broadcasts"
        >
          <RefreshCwIcon
            className={cn("size-4", state.listing && "animate-spin")}
          />
        </Button>
      </div>

      {list.status === "unlisted" && (
        <p className="text-sm text-muted-foreground">Listing Broadcasts…</p>
      )}

      {list.status === "needs-reconnect" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
          <p className="text-sm">{RECONNECT_MESSAGES[list.reason]}</p>
          <Button size="sm" asChild>
            <a
              href={`/api/auth/google/initiate?returnTo=${encodeURIComponent(location.pathname)}`}
            >
              {list.reason === "not-connected"
                ? "Connect Google"
                : "Reconnect Google"}
            </a>
          </Button>
        </div>
      )}

      {list.status === "failed" && (
        <p className="text-sm text-destructive">
          Couldn't list Broadcasts: {list.message}
        </p>
      )}

      {list.status === "listed" && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No upcoming or active Broadcasts. Create one with New Broadcast, or
          schedule one in YouTube Studio, then refresh.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="flex flex-col gap-1 overflow-y-auto">
          {rows.map(({ broadcast, picked, refusal }) => (
            <li key={broadcast.id}>
              <button
                type="button"
                aria-pressed={picked}
                onClick={() =>
                  dispatch({
                    type: "broadcast-clicked",
                    broadcastId: broadcast.id,
                  })
                }
                className={cn(
                  "w-full text-left rounded-md border px-3 py-2 text-sm hover:bg-accent",
                  picked && "border-primary bg-primary/10"
                )}
              >
                <div className="flex items-center gap-1 font-medium">
                  <span className="truncate">{broadcast.title}</span>
                  {picked && (
                    <CheckIcon
                      className="size-4 shrink-0 ml-auto text-primary"
                      aria-label="Picked"
                    />
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {broadcastDetails(broadcast)}
                </div>
                {refusal !== null && (
                  <div className="mt-1 flex gap-1 text-xs text-amber-600">
                    <AlertTriangleIcon className="size-3.5 shrink-0 mt-0.5" />
                    <span>{refusal}</span>
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {newBroadcastForm}
    </div>
  );
};
