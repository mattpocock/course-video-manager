import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  PencilIcon,
  PlusIcon,
  Sparkles,
  Trash2Icon,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

const COLLAPSED_STORAGE_KEY = "reference-panel-collapsed";

const loadCollapsed = (): Record<string, boolean> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

export type ReferenceCandidate = {
  id: string;
  path: string;
  clips: Array<{
    id: string;
    order: string;
    text: string;
    transcribedAt: Date | null;
  }>;
  chapters: Array<{ id: string; order: string; name: string }>;
};

type GroupItem =
  | { kind: "section"; id: string; name: string }
  | { kind: "clip"; id: string; text: string };

type Group = {
  section: { id: string; name: string } | null;
  clips: Array<{ id: string; text: string }>;
};

const groupByChapter = (candidate: ReferenceCandidate): Group[] => {
  const items: Array<GroupItem & { order: string }> = [
    ...candidate.chapters.map((s) => ({
      kind: "section" as const,
      order: s.order,
      id: s.id,
      name: s.name,
    })),
    ...candidate.clips.map((c) => ({
      kind: "clip" as const,
      order: c.order,
      id: c.id,
      text: c.text,
    })),
  ].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));

  const groups: Group[] = [];
  let current: Group = { section: null, clips: [] };
  for (const item of items) {
    if (item.kind === "section") {
      if (current.clips.length > 0 || current.section !== null) {
        groups.push(current);
      }
      current = { section: { id: item.id, name: item.name }, clips: [] };
    } else {
      current.clips.push({ id: item.id, text: item.text });
    }
  }
  if (current.clips.length > 0 || current.section !== null) {
    groups.push(current);
  }
  return groups;
};

type ModalState =
  | {
      mode: "add-at";
      targetItemId: string;
      targetItemType: "clip" | "chapter";
      position: "before" | "after";
      defaultName: string;
    }
  | { mode: "edit"; chapterId: string; currentName: string }
  | null;

export const ReferencePanel = (props: {
  candidates: ReferenceCandidate[];
  selectedId: string;
  onRemove: () => void;
  onAddChapterAt: (input: {
    videoId: string;
    targetItemId: string;
    targetItemType: "clip" | "chapter";
    position: "before" | "after";
    name: string;
  }) => void;
  onEditChapterName: (chapterId: string, name: string) => void;
  onDeleteChapter: (chapterId: string) => void;
  onGenerateChapters: () => void;
  className?: string;
}) => {
  const selected =
    props.candidates.find((c) => c.id === props.selectedId) ??
    props.candidates[0];

  const [modal, setModal] = useState<ModalState>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsed(loadCollapsed());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      COLLAPSED_STORAGE_KEY,
      JSON.stringify(collapsed)
    );
  }, [collapsed]);

  const toggleCollapsed = (chapterId: string) =>
    setCollapsed((prev) => ({ ...prev, [chapterId]: !prev[chapterId] }));

  if (!selected) return null;

  const groups = groupByChapter(selected);
  const chapterIds = selected.chapters.map((s) => s.id);
  const allCollapsed =
    chapterIds.length > 0 && chapterIds.every((id) => collapsed[id]);
  const toggleAll = () => {
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const id of chapterIds) next[id] = !allCollapsed;
      return next;
    });
  };

  const defaultChapterName = `Chapter ${selected.chapters.length + 1}`;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!modal) return;
    const formData = new FormData(e.currentTarget);
    const name = (formData.get("name") as string).trim();
    if (!name) return;
    if (modal.mode === "add-at") {
      props.onAddChapterAt({
        videoId: selected.id,
        targetItemId: modal.targetItemId,
        targetItemType: modal.targetItemType,
        position: modal.position,
        name,
      });
    } else {
      props.onEditChapterName(modal.chapterId, name);
    }
    setModal(null);
  };

  return (
    <div
      className={cn(
        "border rounded-lg bg-muted/30 flex flex-col min-h-0",
        props.className
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">
            Reference
          </span>
          <span className="text-xs font-medium truncate">{selected.path}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {(() => {
            const allTranscribed =
              selected.clips.length > 0 &&
              selected.clips.every((c) => c.transcribedAt !== null);
            const button = (
              <Button
                variant="ghost"
                size="sm"
                className="size-6 p-0"
                onClick={props.onGenerateChapters}
                disabled={!allTranscribed}
                aria-label="Generate Chapters with AI"
              >
                <Sparkles className="size-3" />
              </Button>
            );
            return allTranscribed ? (
              button
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>{button}</span>
                </TooltipTrigger>
                <TooltipContent>
                  Waiting for transcription to complete
                </TooltipContent>
              </Tooltip>
            );
          })()}
          <Button
            variant="ghost"
            size="sm"
            className="size-6 p-0"
            onClick={toggleAll}
            disabled={chapterIds.length === 0}
            aria-label={
              allCollapsed ? "Expand all sections" : "Collapse all sections"
            }
          >
            {allCollapsed ? (
              <ChevronsUpDown className="size-3" />
            ) : (
              <ChevronsDownUp className="size-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-6 p-0"
            onClick={props.onRemove}
            aria-label="Remove reference"
          >
            <X className="size-3" />
          </Button>
        </div>
      </div>

      <div className="overflow-y-auto flex-1 px-3 py-2 space-y-3">
        {groups.map((group, gi) => (
          <div key={group.section?.id ?? `nosection-${gi}`}>
            {group.section !== null && (
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <h4
                    className="text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground font-semibold mb-1 cursor-context-menu flex items-center gap-1"
                    onClick={() => toggleCollapsed(group.section!.id)}
                  >
                    {collapsed[group.section.id] ? (
                      <ChevronRight className="size-3 shrink-0" />
                    ) : (
                      <ChevronDown className="size-3 shrink-0" />
                    )}
                    <span>{group.section.name}</span>
                  </h4>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() =>
                      setModal({
                        mode: "edit",
                        chapterId: group.section!.id,
                        currentName: group.section!.name,
                      })
                    }
                  >
                    <PencilIcon />
                    Edit
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() =>
                      setModal({
                        mode: "add-at",
                        targetItemId: group.section!.id,
                        targetItemType: "chapter",
                        position: "before",
                        defaultName: defaultChapterName,
                      })
                    }
                  >
                    <PlusIcon />
                    Add Chapter Before
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() =>
                      setModal({
                        mode: "add-at",
                        targetItemId: group.section!.id,
                        targetItemType: "chapter",
                        position: "after",
                        defaultName: defaultChapterName,
                      })
                    }
                  >
                    <PlusIcon />
                    Add Chapter After
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => props.onDeleteChapter(group.section!.id)}
                  >
                    <Trash2Icon />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )}
            <div
              className={cn(
                "space-y-1.5",
                group.section !== null &&
                  collapsed[group.section.id] &&
                  "hidden"
              )}
            >
              {group.clips.map((clip) => (
                <ContextMenu key={clip.id}>
                  <ContextMenuTrigger asChild>
                    <p className="text-foreground/80 hover:text-foreground leading-snug text-sm cursor-context-menu">
                      {clip.text}
                    </p>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() =>
                        setModal({
                          mode: "add-at",
                          targetItemId: clip.id,
                          targetItemType: "clip",
                          position: "before",
                          defaultName: defaultChapterName,
                        })
                      }
                    >
                      <PlusIcon />
                      Add Chapter Before
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() =>
                        setModal({
                          mode: "add-at",
                          targetItemId: clip.id,
                          targetItemType: "clip",
                          position: "after",
                          defaultName: defaultChapterName,
                        })
                      }
                    >
                      <PlusIcon />
                      Add Chapter After
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={modal !== null}
        onOpenChange={(open) => !open && setModal(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {modal?.mode === "edit" ? "Edit Chapter" : "Name Chapter"}
            </DialogTitle>
          </DialogHeader>
          <form className="space-y-4 py-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="reference-chapter-name">Chapter Name</Label>
              <Input
                id="reference-chapter-name"
                name="name"
                autoFocus
                defaultValue={
                  modal?.mode === "edit"
                    ? modal.currentName
                    : modal?.mode === "add-at"
                      ? modal.defaultName
                      : ""
                }
                required
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={() => setModal(null)}
                type="button"
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
