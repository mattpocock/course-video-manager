// PROTOTYPE — throwaway. Variant B: "Spotlight, thumb-forward".
// Wide modal. A big page-title header ABOVE the input carries the page stack
// instead of a breadcrumb chip. Root list is flat and ungrouped, ordered by
// expected frequency-of-use. Icon grid is 6 cols of large labelled cells.
// A persistent footer shows the selected item's full name.

import { useCallback, useMemo, useRef } from "react";
import { Command } from "cmdk";
import { ChevronLeft, Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { getIcon } from "./palette-model";
import {
  GRID_PAGES,
  PAGE_TITLES,
  type PaletteState,
} from "./use-palette-state";
import { useGridNav } from "./use-grid-nav";
import "./palette-prototype.css";

const COLUMNS = 6;

export const NAME = "Spotlight — wide, thumb-forward, title header";

/** B disagrees with A about ordering: frequency, not category. */
const FREQUENCY_ORDER = [
  "insert-icon",
  "go-to-diagram",
  "insert-component",
  "preserve-snapshot",
  "save-component",
  "new-diagram",
  "copy-contents",
  "rename-diagram",
  "restore-head",
];

export function VariantB({ state }: { state: PaletteState }) {
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

  const actions = useMemo(
    () =>
      [...state.rootActions].sort(
        (a, b) => FREQUENCY_ORDER.indexOf(a.id) - FREQUENCY_ORDER.indexOf(b.id)
      ),
    [state.rootActions]
  );

  const footer = useMemo(() => {
    if (state.page === "icons") return state.value || "—";
    if (state.page === "components") return state.value || "—";
    if (state.page === "root") {
      return state.rootActions.find((a) => a.id === state.value)?.hint ?? "—";
    }
    return "—";
  }, [state.page, state.value, state.rootActions]);

  return (
    <Dialog open={state.open} onOpenChange={state.setOpen}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={state.blockRadixEscape}
        className="top-[14%] max-w-3xl translate-y-0 gap-0 overflow-hidden border-zinc-700 bg-zinc-900 p-0 text-zinc-100"
      >
        <Command
          value={state.value}
          onValueChange={state.setValue}
          shouldFilter={state.shouldFilter}
          onKeyDown={onKeyDown}
          loop={false}
          className="flex flex-col"
        >
          <div className="flex items-center gap-2 px-4 pt-4 pb-1">
            {state.stack.length > 1 && (
              <button
                type="button"
                onClick={state.pop}
                className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                aria-label="Back"
              >
                <ChevronLeft className="size-5" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-zinc-100">
              {PAGE_TITLES[state.page]}
            </h2>
            {state.page === "icons" && (
              <span className="ml-auto text-xs text-zinc-500">
                {state.icons.length} shown
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 border-b border-zinc-700 px-4 pb-3">
            <Search className="size-4 shrink-0 text-zinc-500" />
            <Command.Input
              autoFocus
              value={state.query}
              onValueChange={state.setQuery}
              placeholder={
                state.page === "nameComponent"
                  ? "Name this component…"
                  : "Start typing…"
              }
              className="w-full bg-transparent text-base outline-none placeholder:text-zinc-600"
            />
          </div>

          <Command.List
            ref={listRef}
            className="palette-proto-scroll max-h-[420px] min-h-[220px] overflow-y-auto p-3"
          >
            {state.page === "root" && (
              <>
                <Command.Empty className="py-12 text-center text-sm text-zinc-500">
                  Nothing matches.
                </Command.Empty>
                {actions.map((a) => {
                  const Icon = getIcon(a.icon);
                  return (
                    <Command.Item
                      key={a.id}
                      value={a.id}
                      keywords={[a.label, a.hint]}
                      onSelect={() => state.runAction(a)}
                      className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2.5 text-zinc-200 select-none data-[selected=true]:bg-zinc-700/80 data-[selected=true]:text-white"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-400">
                        <Icon className="size-4" />
                      </span>
                      <span className="text-[15px]">{a.label}</span>
                      {a.opens && (
                        <span className="ml-auto text-xs text-zinc-500">
                          opens a page
                        </span>
                      )}
                    </Command.Item>
                  );
                })}
              </>
            )}

            {state.page === "icons" && (
              <Command.Group className="[&_[cmdk-group-items]]:grid [&_[cmdk-group-items]]:grid-cols-6 [&_[cmdk-group-items]]:gap-2">
                {state.icons.map(({ name }) => {
                  const Icon = getIcon(name);
                  return (
                    <Command.Item
                      key={name}
                      value={name}
                      onSelect={() => state.insertIcon(name)}
                      className="flex cursor-default flex-col items-center gap-1.5 rounded-lg border border-transparent px-1 py-3 text-zinc-300 select-none data-[selected=true]:border-zinc-500 data-[selected=true]:bg-zinc-700/60 data-[selected=true]:text-white"
                    >
                      <Icon className="size-7" />
                      <span className="w-full truncate text-center text-[10px] text-zinc-500">
                        {name}
                      </span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {state.page === "components" && (
              <>
                <Command.Empty className="py-12 text-center text-sm text-zinc-500">
                  No components match.
                </Command.Empty>
                <Command.Group className="[&_[cmdk-group-items]]:grid [&_[cmdk-group-items]]:grid-cols-3 [&_[cmdk-group-items]]:gap-3">
                  {state.components.map((c) => (
                    <Command.Item
                      key={c.id}
                      value={c.name}
                      onSelect={() => state.insertComponent(c.name)}
                      className="flex cursor-default flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 select-none data-[selected=true]:border-zinc-300 data-[selected=true]:bg-zinc-700"
                    >
                      <img
                        src={c.thumbnail}
                        alt=""
                        className="h-20 w-full object-contain p-2"
                      />
                      <span className="truncate px-2 pb-2 text-xs text-zinc-300">
                        {c.name}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              </>
            )}

            {state.page === "diagrams" && (
              <>
                {state.diagramHits.length === 0 && (
                  <p className="py-12 text-center text-sm text-zinc-500">
                    {state.searching
                      ? "Searching…"
                      : state.query
                        ? "No diagrams match."
                        : "Type to search names and contents."}
                  </p>
                )}
                {state.diagramHits.map((h) => (
                  <Command.Item
                    key={h.snapshotId ?? `${h.diagramId}:current`}
                    value={h.snapshotId ?? `${h.diagramId}:current`}
                    onSelect={() => state.goToDiagram(h)}
                    className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2.5 select-none data-[selected=true]:bg-zinc-700/80"
                  >
                    <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded bg-zinc-800 text-[9px] text-zinc-600">
                      thumb
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] text-zinc-100">
                        {h.diagramName}
                      </span>
                      <span className="line-clamp-1 text-xs text-zinc-500">
                        {h.searchText ?? "—"}
                      </span>
                    </span>
                  </Command.Item>
                ))}
              </>
            )}

            {state.page === "nameComponent" && (
              <div className="px-2 py-8 text-center">
                <p className="mb-4 text-sm text-zinc-400">
                  Saving the current selection as{" "}
                  <span className="text-zinc-100">
                    “{state.query || "(unnamed)"}”
                  </span>
                </p>
                <Command.Item
                  value="__save__"
                  onSelect={() => state.saveComponent(state.query)}
                  className="mx-auto w-40 cursor-default justify-center rounded-lg bg-zinc-700 py-2 text-center text-sm text-zinc-100 select-none data-[selected=true]:bg-zinc-600"
                >
                  Save component
                </Command.Item>
              </div>
            )}
          </Command.List>

          <div className="flex items-center justify-between border-t border-zinc-700 bg-zinc-950/40 px-4 py-2 text-xs">
            <span className="truncate text-zinc-300">{footer}</span>
            <span className="shrink-0 text-zinc-600">
              {isGrid ? "↑↓←→" : "↑↓"} · ⏎ ·{" "}
              {state.stack.length > 1 ? "esc back" : "esc close"}
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
