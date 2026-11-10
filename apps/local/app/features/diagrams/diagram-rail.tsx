import { ArrowLeft, Plus } from "lucide-react";
import { Link } from "react-router";
import { DiagramThumbnail } from "@/features/diagrams/diagram-thumbnail";
import { EditableDiagramName } from "@/features/diagrams/editable-diagram-name";
import { railRowClass } from "@/features/diagrams/rail-row-class";
import { useConfirmDelete } from "@/components/confirm-delete-dialog";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { EntityMenuContent } from "@/features/action-menu/action-menu";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";

export interface RailDiagram {
  id: string;
  name: string;
  thumbnailContentHash: string | null;
}

/**
 * The lower half of the Active Diagram window's right rail: every Diagram, with
 * the way back to **Playground Home** and the way to a new one.
 *
 * Presentation only — every action is the route's, passed in, so this stays a
 * second view of the same handlers the **Command Palette** drives.
 */
export function DiagramRail({
  diagrams,
  activeDiagramId,
  creating,
  onNavigateHome,
  onCreateDiagram,
  onCopyContents,
  onDelete,
  onRenameError,
}: {
  diagrams: readonly RailDiagram[];
  activeDiagramId: string | undefined;
  creating: boolean;
  onNavigateHome: () => void;
  onCreateDiagram: () => void;
  onCopyContents: (id: string) => void;
  onDelete: (id: string) => void;
  onRenameError: (message: string) => void;
}) {
  // Deleting archives the Diagram, and nothing in the app brings one back.
  const confirmDelete = useConfirmDelete<RailDiagram>({
    title: "Delete Diagram",
    description: (d) => `Delete "${d.name}"? This cannot be undone.`,
    onConfirm: (d) => onDelete(d.id),
  });

  return (
    <>
      {confirmDelete.dialog}
      <div className="flex items-stretch border-b border-zinc-700">
        <button
          onClick={onNavigateHome}
          className="flex flex-1 items-center gap-1.5 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
        >
          <ArrowLeft className="h-3 w-3" />
          All Diagrams
        </button>
        <button
          onClick={onCreateDiagram}
          disabled={creating}
          title="New diagram"
          aria-label="New diagram"
          className="flex items-center justify-center border-l border-zinc-700 px-2 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-1">
          {diagrams.map((d) => {
            const isActive = d.id === activeDiagramId;
            return (
              <ContextMenu key={d.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className={
                      "flex items-center gap-2 overflow-hidden rounded border " +
                      railRowClass(isActive)
                    }
                  >
                    <Link
                      to={`/diagram-playground/${d.id}`}
                      className="h-10 w-14 shrink-0 bg-zinc-900"
                      aria-label={`Open ${d.name}`}
                    >
                      <DiagramThumbnail
                        diagramId={d.id}
                        contentHash={d.thumbnailContentHash ?? undefined}
                        className="h-full w-full object-contain"
                      />
                    </Link>
                    <div className="min-w-0 flex-1 pr-2">
                      <EditableDiagramName
                        diagramId={d.id}
                        name={d.name}
                        className={
                          "block w-full truncate text-sm " +
                          (isActive ? "text-zinc-100" : "text-zinc-300")
                        }
                        inputClassName="w-full rounded bg-zinc-900 px-1 text-sm text-zinc-100 outline-none ring-1 ring-zinc-500"
                        onRenameError={onRenameError}
                      />
                    </div>
                  </div>
                </ContextMenuTrigger>
                <EntityMenuContent
                  menu="context"
                  entity={{ type: "diagram", id: d.id }}
                  groups={{
                    copy: [
                      {
                        ...STANDARD_ACTIONS.copy,
                        label: "Copy Contents",
                        onSelect: () => onCopyContents(d.id),
                      },
                    ],
                    danger: [
                      {
                        ...STANDARD_ACTIONS.delete,
                        opensDialog: true,
                        onSelect: () => confirmDelete.request(d),
                      },
                    ],
                  }}
                />
              </ContextMenu>
            );
          })}
        </div>
      </div>
    </>
  );
}
