import type { ReactElement } from "react";
import { useFetcher } from "react-router";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { CopyIcon, PlusIcon } from "lucide-react";

interface DuplicableItem {
  id: string;
  title: string;
}

export function WeekContextMenu({
  items,
  onAddNew,
  children,
}: {
  items: DuplicableItem[];
  onAddNew: () => void;
  children: ReactElement;
}) {
  const fetcher = useFetcher();
  const count = items.length;

  const duplicate = () => {
    if (count === 0) return;
    const fd = new FormData();
    for (const item of items) fd.append("ids", item.id);
    fetcher.submit(fd, {
      method: "post",
      action: "/api/deliverables/duplicate-week",
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={onAddNew}>
          <PlusIcon className="size-3.5 mr-2" />
          Add new
        </ContextMenuItem>
        {count > 0 && (
          <ContextMenuItem onSelect={duplicate}>
            <CopyIcon className="size-3.5 mr-2" />
            Duplicate to next week
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
