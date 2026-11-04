import { AlertTriangleIcon, CheckIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ThumbnailSelector } from "@/features/video-posting/post-page-thumbnail-selector";
import type { LatencyPreference, NewBroadcastSettings } from "./broadcast";
import {
  canCreate,
  newBroadcastReport,
  showsUnlistWhenEnded,
  type newBroadcastReducer,
  type ReportLine,
} from "./new-broadcast-reducer";
import { UnlistWhenEndedCheckbox } from "./unlist-when-ended-checkbox";

type Props = {
  state: newBroadcastReducer.State;
  dispatch: (action: newBroadcastReducer.Action) => void;
};

const PRIVACY_CHOICES: {
  value: NewBroadcastSettings["privacyStatus"];
  label: string;
}[] = [
  { value: "unlisted", label: "Unlisted" },
  { value: "public", label: "Public" },
];

const LATENCY_CHOICES: { value: LatencyPreference; label: string }[] = [
  { value: "ultraLow", label: "Ultra-low" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
];

/** A row of buttons, one pressed: the form's one-of-N choices. */
const Choices = <T extends string>(props: {
  label: string;
  value: T;
  choices: { value: T; label: string }[];
  disabled: boolean;
  onPick: (value: T) => void;
}) => (
  <div className="space-y-1">
    <Label>{props.label}</Label>
    <div className="flex gap-1" role="group" aria-label={props.label}>
      {props.choices.map((c) => (
        <Button
          key={c.value}
          type="button"
          size="sm"
          variant={props.value === c.value ? "default" : "outline"}
          aria-pressed={props.value === c.value}
          disabled={props.disabled}
          onClick={() => props.onPick(c.value)}
        >
          {c.label}
        </Button>
      ))}
    </div>
  </div>
);

export const ReportRow = ({ line }: { line: ReportLine }) => (
  <p
    className={cn(
      "flex gap-1 text-sm",
      line.ok ? "text-foreground" : "text-amber-600"
    )}
  >
    {line.ok ? (
      <CheckIcon className="size-4 shrink-0 mt-0.5 text-green-600" />
    ) : (
      <AlertTriangleIcon className="size-4 shrink-0 mt-0.5" />
    )}
    <span>{line.words}</span>
  </p>
);

/** The "New Broadcast" button beside the Broadcast picker. */
export const NewBroadcastButton = ({ dispatch }: Pick<Props, "dispatch">) => (
  <Button
    variant="secondary"
    size="sm"
    onClick={() => dispatch({ type: "new-broadcast-clicked" })}
  >
    <PlusIcon className="size-4 mr-1" />
    New Broadcast
  </Button>
);

/**
 * The New Broadcast form: title, description, privacy, latency and
 * thumbnail, from the Video's defaults. Once created, it says how
 * monetization, the bind and the thumbnail went; the Broadcast is already
 * picked.
 */
export const NewBroadcastForm = ({ state, dispatch }: Props) => {
  const report = newBroadcastReport(state);
  const locked = state.submitting || state.created !== null;
  return (
    <Dialog
      open={state.open}
      onOpenChange={(open) => !open && dispatch({ type: "form-dismissed" })}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Broadcast</DialogTitle>
          <DialogDescription>
            Created on YouTube with auto-start and auto-stop on, not made for
            kids, then picked.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            dispatch({ type: "create-clicked" });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="new-broadcast-title">Title</Label>
            <Input
              id="new-broadcast-title"
              value={state.draft.title}
              disabled={locked}
              onChange={(e) =>
                dispatch({ type: "title-edited", title: e.target.value })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-broadcast-description">Description</Label>
            <Textarea
              id="new-broadcast-description"
              rows={4}
              value={state.draft.description}
              disabled={locked}
              onChange={(e) =>
                dispatch({
                  type: "description-edited",
                  description: e.target.value,
                })
              }
            />
          </div>
          <Choices
            label="Privacy"
            value={state.draft.privacyStatus}
            choices={PRIVACY_CHOICES}
            disabled={locked}
            onPick={(privacyStatus) =>
              dispatch({ type: "privacy-picked", privacyStatus })
            }
          />
          {showsUnlistWhenEnded(state) && (
            <UnlistWhenEndedCheckbox id="unlist-when-ended-new" />
          )}
          <Choices
            label="Latency"
            value={state.draft.latencyPreference}
            choices={LATENCY_CHOICES}
            disabled={locked}
            onPick={(latencyPreference) =>
              dispatch({ type: "latency-picked", latencyPreference })
            }
          />
          <ThumbnailSelector
            videoId={state.video.id}
            thumbnails={state.video.thumbnails}
            selectedThumbnailId={state.draft.thumbnailId}
            onSelectThumbnail={(thumbnailId) =>
              dispatch({ type: "thumbnail-picked", thumbnailId })
            }
          />
          {state.error !== null && (
            <p role="alert" className="text-sm text-destructive">
              Couldn't create the Broadcast: {state.error}
            </p>
          )}
          {report !== null && (
            <div className="space-y-1 rounded-md border p-2">
              <ReportRow line={{ ok: true, words: "Created and picked." }} />
              <ReportRow line={report.monetization} />
              <ReportRow line={report.bind} />
              <ReportRow line={report.thumbnail} />
            </div>
          )}
          <DialogFooter>
            {report === null ? (
              <Button type="submit" disabled={!canCreate(state)}>
                {state.submitting ? "Creating…" : "Create"}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => dispatch({ type: "form-dismissed" })}
              >
                Done
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
