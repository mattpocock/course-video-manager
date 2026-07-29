// PROTOTYPE — throwaway. Variant C: "Docked inspector".
// NOT a modal — no Radix Dialog, no backdrop. Anchored to the top-left of the
// canvas so the diagram stays fully visible while you browse. Two panes: the
// list/grid on the left, a live preview of the highlighted item on the right.
// The page stack is a visible breadcrumb trail, not a chip.

import { useCallback, useMemo, useRef } from "react";
import { Command } from "cmdk";
import { ChevronRight, Search, X } from "lucide-react";
import { getIcon } from "./palette-model";
import {
  GRID_PAGES,
  PAGE_TITLES,
  type PaletteState,
} from "./use-palette-state";
import { useGridNav } from "./use-grid-nav";
import "./palette-prototype.css";

const COLUMNS = 5;

export const NAME = "Docked inspector — non-modal, preview pane";

export function VariantC({ state }: { state: PaletteState }) {
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
      // No Radix layer here, so root-level Escape has to close by hand.
      if (e.key === "Escape" && state.stack.length === 1) {
        e.preventDefault();
        state.setOpen(false);
        return;
      }
      state.onStackKeyDown(e);
      if (e.defaultPrevented) return;
      gridNav(e);
    },
    [state, gridNav]
  );

  const preview = useMemo(() => {
    if (state.page === "icons" && state.value) {
      const Icon = getIcon(state.value as never);
      if (!Icon) return null;
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-4">
          <div className="flex size-32 items-center justify-center rounded-lg bg-zinc-950">
            <Icon className="size-20 text-white" strokeWidth={2} />
          </div>
          <p className="text-center text-sm text-zinc-200">{state.value}</p>
          <p className="text-center text-[11px] text-zinc-500">
            Inserts as an IconShape at viewport centre, colour&nbsp;white.
          </p>
        </div>
      );
    }
    if (state.page === "components" && state.value) {
      const c = state.components.find((x) => x.name === state.value);
      if (!c) return null;
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-4">
          <img
            src={c.thumbnail}
            alt=""
            className="h-32 w-full rounded-lg bg-zinc-950 object-contain p-3"
          />
          <p className="text-center text-sm text-zinc-200">{c.name}</p>
          <p className="text-[11px] text-zinc-500">{c.shapeCount} shapes</p>
        </div>
      );
    }
    if (state.page === "root") {
      const a = state.rootActions.find((x) => x.id === state.value);
      if (!a) return null;
      const Icon = getIcon(a.icon);
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center">
          <Icon className="size-10 text-zinc-400" />
          <p className="text-sm text-zinc-100">{a.label}</p>
          <p className="text-xs text-zinc-500">{a.hint}</p>
        </div>
      );
    }
    if (state.page === "diagrams") {
      const h = state.diagramHits.find(
        (x) => (x.snapshotId ?? `${x.diagramId}:current`) === state.value
      );
      if (!h) return null;
      return (
        <div className="flex h-full flex-col gap-3 p-4">
          <div className="flex h-28 items-center justify-center rounded bg-zinc-950 text-[10px] text-zinc-600">
            thumbnail
          </div>
          <p className="text-sm text-zinc-100">{h.diagramName}</p>
          <p className="line-clamp-6 text-[11px] leading-relaxed text-zinc-500">
            {h.searchText ?? "—"}
          </p>
        </div>
      );
    }
    return null;
  }, [
    state.page,
    state.value,
    state.components,
    state.rootActions,
    state.diagramHits,
  ]);

  if (!state.open) return null;

  return (
    <div className="palette-proto-docked absolute top-4 left-4 z-[60] flex w-[620px] overflow-hidden rounded-lg bg-zinc-900 text-zinc-100">
      <Command
        value={state.value}
        onValueChange={state.setValue}
        shouldFilter={state.shouldFilter}
        onKeyDown={onKeyDown}
        loop={false}
        className="flex min-w-0 flex-1 flex-col"
      >
        <div className="flex items-center gap-1 border-b border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500">
          {state.stack.map((p, i) => (
            <span key={p + i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3" />}
              <span
                className={i === state.stack.length - 1 ? "text-zinc-200" : ""}
              >
                {PAGE_TITLES[p]}
              </span>
            </span>
          ))}
          <button
            type="button"
            onClick={() => state.setOpen(false)}
            className="ml-auto rounded p-0.5 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="flex h-9 items-center gap-2 border-b border-zinc-800 px-3">
          <Search className="size-3.5 shrink-0 text-zinc-600" />
          <Command.Input
            autoFocus
            value={state.query}
            onValueChange={state.setQuery}
            placeholder={state.page === "nameComponent" ? "Name…" : "Search…"}
            className="h-full w-full bg-transparent text-[13px] outline-none placeholder:text-zinc-600"
          />
        </div>

        <Command.List
          ref={listRef}
          className="palette-proto-scroll h-[300px] overflow-y-auto p-1.5"
        >
          {state.page === "root" && (
            <>
              <Command.Empty className="py-10 text-center text-xs text-zinc-500">
                Nothing matches.
              </Command.Empty>
              {state.rootActions.map((a) => {
                const Icon = getIcon(a.icon);
                return (
                  <Command.Item
                    key={a.id}
                    value={a.id}
                    keywords={[a.label, a.hint]}
                    onSelect={() => state.runAction(a)}
                    className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-[13px] text-zinc-300 select-none data-[selected=true]:bg-zinc-700 data-[selected=true]:text-white"
                  >
                    <Icon className="size-3.5 text-zinc-500" />
                    {a.label}
                  </Command.Item>
                );
              })}
            </>
          )}

          {state.page === "icons" && (
            <Command.Group className="[&_[cmdk-group-items]]:grid [&_[cmdk-group-items]]:grid-cols-5 [&_[cmdk-group-items]]:gap-1.5">
              {state.icons.map(({ name }) => {
                const Icon = getIcon(name);
                return (
                  <Command.Item
                    key={name}
                    value={name}
                    onSelect={() => state.insertIcon(name)}
                    title={name}
                    className="flex aspect-square cursor-default items-center justify-center rounded-md border border-zinc-800 bg-zinc-800/40 text-zinc-300 select-none data-[selected=true]:border-zinc-400 data-[selected=true]:bg-zinc-700 data-[selected=true]:text-white"
                  >
                    <Icon className="size-5" />
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {state.page === "components" && (
            <>
              <Command.Empty className="py-10 text-center text-xs text-zinc-500">
                No components match.
              </Command.Empty>
              <Command.Group className="[&_[cmdk-group-items]]:grid [&_[cmdk-group-items]]:grid-cols-5 [&_[cmdk-group-items]]:gap-1.5">
                {state.components.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={c.name}
                    onSelect={() => state.insertComponent(c.name)}
                    title={c.name}
                    className="flex aspect-square cursor-default items-center justify-center rounded-md border border-zinc-800 bg-zinc-800/40 p-1 select-none data-[selected=true]:border-zinc-400 data-[selected=true]:bg-zinc-700"
                  >
                    <img
                      src={c.thumbnail}
                      alt=""
                      className="h-full w-full object-contain"
                    />
                  </Command.Item>
                ))}
              </Command.Group>
            </>
          )}

          {state.page === "diagrams" && (
            <>
              {state.diagramHits.length === 0 && (
                <p className="py-10 text-center text-xs text-zinc-500">
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
                  className="cursor-default rounded px-2 py-1.5 text-[13px] text-zinc-300 select-none data-[selected=true]:bg-zinc-700 data-[selected=true]:text-white"
                >
                  {h.diagramName}
                </Command.Item>
              ))}
            </>
          )}

          {state.page === "nameComponent" && (
            <div className="p-3 text-xs text-zinc-400">
              <Command.Item
                value="__save__"
                onSelect={() => state.saveComponent(state.query)}
                className="cursor-default justify-center rounded bg-zinc-700 py-1.5 text-center text-zinc-100 select-none data-[selected=true]:bg-zinc-600"
              >
                Save “{state.query || "(unnamed)"}”
              </Command.Item>
            </div>
          )}
        </Command.List>

        <div className="border-t border-zinc-800 px-3 py-1.5 text-[10px] text-zinc-600">
          {isGrid ? "↑↓←→" : "↑↓"} navigate · ⏎ select ·{" "}
          {state.stack.length > 1 ? "esc back" : "esc close"} · canvas stays
          live
        </div>
      </Command>

      <div className="w-[220px] shrink-0 border-l border-zinc-800 bg-zinc-950/50">
        {preview ?? (
          <div className="flex h-full items-center justify-center p-4 text-center text-[11px] text-zinc-600">
            Nothing highlighted
          </div>
        )}
      </div>
    </div>
  );
}
