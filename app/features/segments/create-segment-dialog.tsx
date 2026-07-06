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
import { cn } from "@/lib/utils";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BEAT_KINDS,
  BEAT_KIND_DESCRIPTIONS,
  BEAT_KIND_ICONS,
  BEAT_KIND_LABELS,
  type BeatKind,
} from "./segment-kinds";

/**
 * Where a new Segment should land. The kind chosen from the "Add segment" menu
 * seeds the dialog, but the user can change it there before confirming.
 */
type CreateSegmentIntent = {
  videoId: string;
  kind: BeatKind;
  beforeSegmentId: string | null;
};

const RequestCreateSegmentContext = createContext<
  (intent: CreateSegmentIntent) => void
>(() => {});

/**
 * Open the "new Segment" dialog seeded with a kind and insertion anchor. The
 * caller still picks the kind from its menu; the dialog lets the user name the
 * Segment (and reconsider the kind) before it's created. No-op without a
 * surrounding {@link CreateSegmentDialogProvider}.
 */
export function useRequestCreateSegment() {
  return useContext(RequestCreateSegmentContext);
}

/**
 * Hosts the single create-Segment dialog for a surface and exposes
 * {@link useRequestCreateSegment} to open it. On confirm it emits a
 * `create-segment` event carrying the typed title, chosen kind, and anchor.
 */
export function CreateSegmentDialogProvider({
  submitEvent,
  children,
}: {
  submitEvent: (event: CourseEditorEvent) => void;
  children: ReactNode;
}) {
  const [intent, setIntent] = useState<CreateSegmentIntent | null>(null);

  const request = useCallback((next: CreateSegmentIntent) => {
    setIntent(next);
  }, []);

  return (
    <RequestCreateSegmentContext.Provider value={request}>
      {children}
      {intent && (
        <CreateSegmentDialog
          // Remount per request so the form resets to the seeded kind/empty title.
          key={`${intent.videoId}:${intent.beforeSegmentId}:${intent.kind}`}
          intent={intent}
          onClose={() => setIntent(null)}
          onConfirm={(title, kind) => {
            submitEvent({
              type: "create-segment",
              videoId: intent.videoId,
              kind,
              title,
              beforeSegmentId: intent.beforeSegmentId,
            });
            setIntent(null);
          }}
        />
      )}
    </RequestCreateSegmentContext.Provider>
  );
}

function CreateSegmentDialog({
  intent,
  onClose,
  onConfirm,
}: {
  intent: CreateSegmentIntent;
  onClose: () => void;
  onConfirm: (title: string, kind: BeatKind) => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<BeatKind>(intent.kind);
  const inputRef = useRef<HTMLInputElement>(null);

  // The dialog is opened from a context/dropdown menu, and Radix menus restore
  // focus to their trigger as they close — which lands *after* this mounts and
  // would steal focus from the input. Claim it back on the next tick.
  useEffect(() => {
    const id = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const confirm = () => onConfirm(title.trim(), kind);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        // Don't let Radix focus the close button first; we focus the input below.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>New segment</DialogTitle>
          <DialogDescription>
            Name the segment and pick its kind.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="segment-title">Name</Label>
            <Input
              id="segment-title"
              ref={inputRef}
              value={title}
              placeholder={BEAT_KIND_LABELS[kind]}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirm();
                }
              }}
            />
          </div>

          <div className="grid gap-2">
            <Label>Kind</Label>
            <div className="grid gap-1">
              {BEAT_KINDS.map((k) => {
                const Icon = BEAT_KIND_ICONS[k];
                const selected = k === kind;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={cn(
                      "flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:bg-muted"
                    )}
                  >
                    <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="flex flex-col">
                      <span>{BEAT_KIND_LABELS[k]}</span>
                      <span className="text-xs text-muted-foreground">
                        {BEAT_KIND_DESCRIPTIONS[k]}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm}>Create segment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
