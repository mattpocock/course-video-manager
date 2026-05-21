import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

export type ClipForPreview = {
  id: string;
  text: string;
};

type ProposedSection = { beforeClipId: string; title: string };

type StreamState = {
  clips: ClipForPreview[] | null;
  sections: ProposedSection[];
  status: "streaming" | "done" | "error";
  errorMessage: string | null;
};

const initialState: StreamState = {
  clips: null,
  sections: [],
  status: "streaming",
  errorMessage: null,
};

export const GenerateChaptersModal = (props: {
  open: boolean;
  videoId: string;
  videoLabel: string;
  clips?: ClipForPreview[];
  onClose: () => void;
  onConfirm: (sections: ProposedSection[]) => Promise<void>;
}) => {
  const [state, setState] = useState<StreamState>(initialState);
  const [confirming, setConfirming] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>(
    {}
  );

  useEffect(() => {
    if (!props.open) return;

    setState({
      ...initialState,
      clips: props.clips ?? null,
    });
    setConfirming(false);

    const source = new EventSource(
      `/api/videos/${props.videoId}/suggest-chapters`
    );

    source.addEventListener("clips", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        clips: ClipForPreview[];
      };
      setState((prev) => (prev.clips ? prev : { ...prev, clips: data.clips }));
    });

    source.addEventListener("section", (e) => {
      const section = JSON.parse((e as MessageEvent).data) as ProposedSection;
      setState((prev) => ({
        ...prev,
        sections: [...prev.sections, section],
      }));
    });

    source.addEventListener("done", () => {
      setState((prev) => ({ ...prev, status: "done" }));
      source.close();
    });

    source.addEventListener("error", (e) => {
      let message = "Stream error";
      const ev = e as MessageEvent;
      if (ev.data) {
        try {
          const parsed = JSON.parse(ev.data) as { message?: string };
          if (parsed.message) message = parsed.message;
        } catch {
          // ignore
        }
      }
      setState((prev) =>
        prev.status === "done"
          ? prev
          : { ...prev, status: "error", errorMessage: message }
      );
      source.close();
    });

    return () => {
      source.close();
    };
  }, [props.open, props.videoId, props.clips]);

  const clips = state.clips ?? [];
  const validIds = new Set(clips.map((c) => c.id));
  const visibleSections = state.sections.filter((s) =>
    validIds.has(s.beforeClipId)
  );
  const sectionsByBeforeClipId = new Map(
    visibleSections.map((s) => [s.beforeClipId, s.title])
  );

  const handleConfirm = async () => {
    if (state.status !== "done") return;
    setConfirming(true);
    try {
      await props.onConfirm(visibleSections);
    } finally {
      setConfirming(false);
    }
  };

  const isInitialLoading =
    state.status === "streaming" && state.sections.length === 0;

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && !confirming && props.onClose()}
    >
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> Generate Chapters
          </DialogTitle>
          <DialogDescription>
            Preview AI-proposed Chapters for{" "}
            <span className="font-medium">{props.videoLabel}</span>. Confirming
            replaces all existing Chapters on this video.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto border rounded-md bg-muted/30 p-3 min-h-[200px]">
          {state.status === "error" && (
            <div className="text-sm text-destructive">
              Failed to generate: {state.errorMessage ?? "Unknown error"}
            </div>
          )}

          {state.status !== "error" && isInitialLoading && (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2">
              <Loader2 className="size-4 animate-spin" />
              Generating proposals…
            </div>
          )}

          {state.status === "done" &&
            visibleSections.length === 0 &&
            state.errorMessage === null && (
              <div className="text-sm text-muted-foreground italic">
                AI proposed no Chapters for this video. Confirming will archive
                any existing ones.
              </div>
            )}

          {state.status !== "error" && visibleSections.length > 0 && (
            <div className="space-y-4">
              {(() => {
                const groups: Array<{
                  title: string | null;
                  clips: ClipForPreview[];
                }> = [];
                let current: { title: string | null; clips: ClipForPreview[] } =
                  { title: null, clips: [] };

                for (const clip of clips) {
                  const newTitle = sectionsByBeforeClipId.get(clip.id);
                  if (newTitle !== undefined) {
                    if (current.title !== null || current.clips.length > 0) {
                      groups.push(current);
                    }
                    current = { title: newTitle, clips: [clip] };
                  } else {
                    current.clips.push(clip);
                  }
                }
                if (current.title !== null || current.clips.length > 0) {
                  groups.push(current);
                }

                return groups.map((group, i) => {
                  const wordCount = group.clips.reduce(
                    (sum, c) =>
                      sum +
                      c.text.split(/\s+/).filter((w) => w.length > 0).length,
                    0
                  );
                  const expanded = expandedGroups[i] ?? false;
                  return (
                    <div key={i}>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedGroups((prev) => ({
                            ...prev,
                            [i]: !expanded,
                          }))
                        }
                        className="flex items-center gap-1 w-full text-left mb-1 hover:text-foreground"
                      >
                        {expanded ? (
                          <ChevronDown className="size-3 shrink-0" />
                        ) : (
                          <ChevronRight className="size-3 shrink-0" />
                        )}
                        {group.title !== null ? (
                          <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                            {group.title}
                          </h4>
                        ) : (
                          <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground/60 italic font-semibold">
                            (before first proposed section)
                          </h4>
                        )}
                        <span className="text-[11px] text-muted-foreground/70 font-normal normal-case ml-1">
                          {wordCount} {wordCount === 1 ? "word" : "words"}
                        </span>
                      </button>
                      {expanded && (
                        <div className="space-y-1.5 pl-4">
                          {group.clips.map((clip) => (
                            <p
                              key={clip.id}
                              className="text-foreground/80 leading-snug text-sm"
                            >
                              {clip.text.trim() || (
                                <span className="italic text-muted-foreground">
                                  (empty transcript)
                                </span>
                              )}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
              {state.status === "streaming" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
                  <Loader2 className="size-3 animate-spin" />
                  Streaming more sections…
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={props.onClose}
            disabled={confirming}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={state.status !== "done" || confirming}
          >
            {confirming ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Applying…
              </>
            ) : (
              "Confirm"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
