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
} from "./beat-kinds";

/**
 * Where a new Beat should land. The kind chosen from the "Add beat" menu
 * seeds the dialog, but the user can change it there before confirming.
 */
type CreateBeatIntent = {
  videoId: string;
  kind: BeatKind;
  beforeBeatId: string | null;
};

const RequestCreateBeatContext = createContext<
  (intent: CreateBeatIntent) => void
>(() => {});

/**
 * Open the "new Beat" dialog seeded with a kind and insertion anchor. The
 * caller still picks the kind from its menu; the dialog lets the user name the
 * Beat (and reconsider the kind) before it's created. No-op without a
 * surrounding {@link CreateBeatDialogProvider}.
 */
export function useRequestCreateBeat() {
  return useContext(RequestCreateBeatContext);
}

/**
 * Hosts the single create-Beat dialog for a surface and exposes
 * {@link useRequestCreateBeat} to open it. On confirm it emits a
 * `create-beat` event carrying the typed title, chosen kind, and anchor.
 */
export function CreateBeatDialogProvider({
  submitEvent,
  children,
}: {
  submitEvent: (event: CourseEditorEvent) => void;
  children: ReactNode;
}) {
  const [intent, setIntent] = useState<CreateBeatIntent | null>(null);

  const request = useCallback((next: CreateBeatIntent) => {
    setIntent(next);
  }, []);

  return (
    <RequestCreateBeatContext.Provider value={request}>
      {children}
      {intent && (
        <CreateBeatDialog
          // Remount per request so the form resets to the seeded kind/empty title.
          key={`${intent.videoId}:${intent.beforeBeatId}:${intent.kind}`}
          intent={intent}
          onClose={() => setIntent(null)}
          onConfirm={(title, kind) => {
            submitEvent({
              type: "create-beat",
              videoId: intent.videoId,
              kind,
              title,
              beforeBeatId: intent.beforeBeatId,
            });
            setIntent(null);
          }}
        />
      )}
    </RequestCreateBeatContext.Provider>
  );
}

function CreateBeatDialog({
  intent,
  onClose,
  onConfirm,
}: {
  intent: CreateBeatIntent;
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
          <DialogTitle>New beat</DialogTitle>
          <DialogDescription>
            Name the beat and pick its kind.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="beat-title">Name</Label>
            <Input
              id="beat-title"
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
          <Button onClick={confirm}>Create beat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
