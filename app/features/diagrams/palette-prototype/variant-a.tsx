// PROTOTYPE — throwaway. Variant A: "Raycast".
// Compact centred modal, grouped root list with section headings, breadcrumb
// chip inside the input, very dense icon grid (10 cols / 28px cells), keyboard
// hints right-aligned on every row. Uses the shadcn command.tsx wrappers as
// shipped, to prove they survive contact with a grid.

import { useCallback, useMemo, useRef } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { CornerDownLeft } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getIcon } from "./palette-model";
import {
  GRID_PAGES,
  PAGE_TITLES,
  type PaletteState,
} from "./use-palette-state";
import { useGridNav } from "./use-grid-nav";
import "./palette-prototype.css";

const COLUMNS = 10;

export const NAME = "Raycast — dense, grouped, breadcrumb chip";

export function VariantA({ state }: { state: PaletteState }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const isGrid = GRID_PAGES.includes(state.page);

  const gridNav = useGridNav({
    listRef,
    columns: COLUMNS,
    value: state.value,
    onValueChange: state.setValue,
    enabled: isGrid,
  });

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      state.onStackKeyDown(e);
      if (e.defaultPrevented) return;
      gridNav(e);
    },
    [state, gridNav]
  );

  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof state.rootActions>();
    for (const a of state.rootActions) {
      const arr = byGroup.get(a.group) ?? [];
      arr.push(a);
      byGroup.set(a.group, arr);
    }
    return [...byGroup.entries()];
  }, [state.rootActions]);

  return (
    <Dialog open={state.open} onOpenChange={state.setOpen}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={state.blockRadixEscape}
        className="top-[22%] max-w-xl translate-y-0 overflow-hidden border-zinc-700 bg-zinc-900 p-0 text-zinc-100"
      >
        <Command
          value={state.value}
          onValueChange={state.setValue}
          shouldFilter={state.shouldFilter}
          onKeyDown={onKeyDown}
          className="bg-zinc-900 text-zinc-100"
          loop={false}
        >
          <div className="flex h-11 items-center gap-2 border-b border-zinc-700 px-3">
            {state.stack.length > 1 && (
              <span className="shrink-0 rounded bg-zinc-700 px-1.5 py-0.5 text-[11px] font-medium text-zinc-200">
                {PAGE_TITLES[state.page]}
              </span>
            )}
            <CommandPrimitive.Input
              autoFocus
              value={state.query}
              onValueChange={state.setQuery}
              placeholder={
                state.page === "root"
                  ? "Type a command…"
                  : state.page === "nameComponent"
                    ? "Name this component…"
                    : "Search…"
              }
              className="h-full w-full bg-transparent text-sm outline-none placeholder:text-zinc-500"
            />
          </div>

          <CommandList
            ref={listRef}
            className="max-h-[340px] overflow-y-auto p-1"
          >
            {state.page === "root" && (
              <>
                <CommandEmpty className="py-8 text-center text-sm text-zinc-500">
                  No matching command.
                </CommandEmpty>
                {groups.map(([group, actions]) => (
                  <CommandGroup
                    key={group}
                    heading={group}
                    className="text-zinc-100 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-heading]]:uppercase"
                  >
                    {actions.map((a) => {
                      const Icon = getIcon(a.icon);
                      return (
                        <CommandItem
                          key={a.id}
                          value={a.id}
                          keywords={[a.label, a.hint]}
                          onSelect={() => state.runAction(a)}
                          className="gap-2 rounded px-2 py-1.5 text-sm text-zinc-200 data-[selected=true]:bg-zinc-700 data-[selected=true]:text-zinc-50"
                        >
                          <Icon className="size-4 text-zinc-400" />
                          <span>{a.label}</span>
                          <span className="ml-auto text-[11px] text-zinc-500">
                            {a.opens ? (
                              "→"
                            ) : (
                              <CornerDownLeft className="size-3" />
                            )}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              </>
            )}

            {state.page === "icons" && (
              <CommandGroup
                heading={`${state.icons.length} icons`}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-items]]:grid [&_[cmdk-group-items]]:grid-cols-10 [&_[cmdk-group-items]]:gap-1"
              >
                {state.icons.map(({ name }) => {
                  const Icon = getIcon(name);
                  return (
                    <CommandItem
                      key={name}
                      value={name}
                      onSelect={() => state.insertIcon(name)}
                      title={name}
                      className="flex aspect-square items-center justify-center rounded p-0 text-zinc-300 data-[selected=true]:bg-zinc-700 data-[selected=true]:text-white"
                    >
                      <Icon className="size-4" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {state.page === "components" && (
              <>
                <CommandEmpty className="py-8 text-center text-sm text-zinc-500">
                  No components match.
                </CommandEmpty>
                <CommandGroup
                  heading="Components"
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-items]]:grid [&_[cmdk-group-items]]:grid-cols-10 [&_[cmdk-group-items]]:gap-1"
                >
                  {state.components.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.name}
                      onSelect={() => state.insertComponent(c.name)}
                      title={c.name}
                      className="col-span-2 flex flex-col items-stretch gap-0 rounded border border-zinc-700 bg-zinc-800 p-0 data-[selected=true]:border-zinc-400 data-[selected=true]:bg-zinc-700"
                    >
                      <img
                        src={c.thumbnail}
                        alt=""
                        className="h-10 w-full object-contain p-1"
                      />
                      <span className="truncate px-1 pb-1 text-[10px] text-zinc-400">
                        {c.name}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {state.page === "diagrams" && (
              <CommandGroup
                heading={state.searching ? "Searching…" : "Diagrams"}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:text-zinc-500"
              >
                {state.diagramHits.length === 0 && !state.searching && (
                  <p className="px-2 py-6 text-center text-sm text-zinc-500">
                    {state.query
                      ? "No diagrams match."
                      : "Type to search names and contents."}
                  </p>
                )}
                {state.diagramHits.map((h) => (
                  <CommandItem
                    key={h.snapshotId ?? `${h.diagramId}:current`}
                    value={h.snapshotId ?? `${h.diagramId}:current`}
                    onSelect={() => state.goToDiagram(h)}
                    className="flex-col items-start gap-0 rounded px-2 py-1.5 data-[selected=true]:bg-zinc-700"
                  >
                    <span className="text-sm text-zinc-100">
                      {h.diagramName}
                    </span>
                    <span className="line-clamp-1 text-[11px] text-zinc-500">
                      {h.searchText ?? "—"}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {state.page === "nameComponent" && (
              <div className="px-3 py-6 text-sm text-zinc-400">
                Press <kbd className="rounded bg-zinc-700 px-1">Enter</kbd> to
                save the selection as{" "}
                <span className="text-zinc-100">
                  “{state.query || "(unnamed)"}”
                </span>
                .
                <CommandItem
                  value="__save__"
                  onSelect={() => state.saveComponent(state.query)}
                  className="mt-3 justify-center rounded bg-zinc-700 py-1.5 text-zinc-100 data-[selected=true]:bg-zinc-600"
                >
                  Save component
                </CommandItem>
              </div>
            )}
          </CommandList>

          <div className="flex items-center gap-3 border-t border-zinc-700 px-3 py-1.5 text-[10px] text-zinc-500">
            <span>↑↓{isGrid ? "←→" : ""} navigate</span>
            <span>⏎ select</span>
            <span>{state.stack.length > 1 ? "esc back" : "esc close"}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
