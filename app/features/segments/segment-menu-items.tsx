import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { Plus, Trash2 } from "lucide-react";
import {
  BEAT_KINDS,
  BEAT_KIND_DESCRIPTIONS,
  BEAT_KIND_ICONS,
  BEAT_KIND_LABELS,
  type BeatKind,
} from "./segment-kinds";

/**
 * Five context-menu items, one per Beat kind, each with its distinct icon.
 * Used both to create a Segment of a kind (on a Video) and to reclassify one
 * (on a Segment).
 */
export function BeatKindMenuItems({
  onSelect,
}: {
  onSelect: (kind: BeatKind) => void;
}) {
  return (
    <>
      {BEAT_KINDS.map((kind) => {
        const Icon = BEAT_KIND_ICONS[kind];
        return (
          <ContextMenuItem
            key={kind}
            onSelect={() => onSelect(kind)}
            className="items-start gap-2"
          >
            <Icon className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex flex-col">
              <span>{BEAT_KIND_LABELS[kind]}</span>
              <span className="text-xs text-muted-foreground">
                {BEAT_KIND_DESCRIPTIONS[kind]}
              </span>
            </div>
          </ContextMenuItem>
        );
      })}
    </>
  );
}

/** "Add segment ▸ <kind>" submenu for a Video's context menu. */
export function AddSegmentSubMenu({
  onAdd,
}: {
  onAdd: (kind: BeatKind) => void;
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Plus className="w-4 h-4" />
        Add segment
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <BeatKindMenuItems onSelect={onAdd} />
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** A Segment's own context menu: change kind, add a neighbour (before/after) + delete. */
export function SegmentContextMenuContent({
  onSetKind,
  onAddBefore,
  onAddAfter,
  onDelete,
}: {
  onSetKind: (kind: BeatKind) => void;
  onAddBefore: (kind: BeatKind) => void;
  onAddAfter: (kind: BeatKind) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Change kind</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <BeatKindMenuItems onSelect={onSetKind} />
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Plus className="w-4 h-4" />
          Add segment before
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <BeatKindMenuItems onSelect={onAddBefore} />
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Plus className="w-4 h-4" />
          Add segment after
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <BeatKindMenuItems onSelect={onAddAfter} />
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={onDelete}>
        <Trash2 className="w-4 h-4" />
        Delete
      </ContextMenuItem>
    </>
  );
}
