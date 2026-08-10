import { useCallback, useMemo, useRef } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { CornerDownLeft, Loader2, PenLine, Trash2 } from "lucide-react";
import type { Editor } from "tldraw";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { IconGlyph } from "./icon-glyph";
import { ComponentCard, DiagramCard } from "./result-cards";
import { GROUP_ORDER, PAGE_META, type PaletteGroup } from "./palette-model";
import { usePalette, type PaletteHandlers } from "./use-palette";
import { useGridNav } from "./use-grid-nav";
import "./command-palette.css";

/**
 * The Cmd+K command palette, mounted inside the Active Diagram window's canvas
 * box — and nowhere else. It is invisible until summoned, which is what lets it
 * coexist with ADR 0004's requirement that "every pixel of chrome must
 * disappear" in tldraw Focus Mode. Cmd+F summons it too, straight onto the
 * diagram search — see `palette-shortcuts`.
 *
 * There is deliberately NO on-canvas affordance pointing at Cmd+K. The grouped
 * root list is itself the discovery surface, once the palette is open.
 */
export function CommandPalette({
  editorRef,
  handlers,
}: {
  editorRef: React.RefObject<Editor | null>;
  handlers: PaletteHandlers;
}) {
  const state = usePalette({ editorRef, handlers });
  const listRef = useRef<HTMLDivElement | null>(null);
  const { title, placeholder, columns } = PAGE_META[state.page];

  // One grid, two meanings. `replacing` is the icon Enter would REWRITE rather
  // than add a second one beside — non-null on the replace page only, so it is
  // both the mode switch and the target.
  const isIconGrid = state.page === "icons" || state.page === "replaceIcon";
  const replacing = state.page === "replaceIcon" ? state.selectedIcon : null;

  const gridNav = useGridNav({
    listRef,
    columns: columns ?? 1,
    value: state.nav.value,
    onValueChange: (value) => state.dispatch({ type: "setValue", value }),
    enabled: columns !== undefined,
  });

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        state.navigateBack({ type: "escape" });
        return;
      }
      if (e.key === "Backspace" && state.nav.query === "") {
        if (state.nav.stack.length > 1) e.preventDefault();
        state.navigateBack({ type: "backspace" });
        return;
      }
      gridNav(e);
    },
    [state, gridNav]
  );

  /**
   * Radix's Escape handling is CAPTURE-PHASE, and this silently half-works
   * without the guard: `DismissableLayer` binds keydown on `ownerDocument` with
   * `{capture: true}`, so a React bubble-phase handler — even one calling
   * stopPropagation — runs after the dialog has already dismissed, and Esc pops
   * a page AND closes the palette in a single keystroke. `onEscapeKeyDown` is
   * the only fix: Radix calls it first and respects preventDefault.
   */
  const blockRadixEscape = useCallback(
    (e: globalThis.KeyboardEvent) => {
      if (state.nav.stack.length > 1) e.preventDefault();
    },
    [state.nav.stack.length]
  );

  const grouped = useMemo(() => {
    return GROUP_ORDER.map(
      (group) =>
        [group, state.rootActions.filter((a) => a.group === group)] as const
    ).filter(([, actions]) => actions.length > 0);
  }, [state.rootActions]);

  return (
    <Dialog open={state.open} onOpenChange={state.onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={blockRadixEscape}
        // `sm:max-w-xl`, not `max-w-xl`: the shared DialogContent base carries
        // `sm:max-w-lg`, and twMerge keeps a `sm:`-prefixed rule over an
        // unprefixed one — so a bare `max-w-xl` would be silently overridden at
        // every width that matters.
        className="top-[22%] sm:max-w-xl translate-y-0 overflow-hidden border-zinc-700 bg-zinc-900 p-0 text-zinc-100"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Insert icons and components, replace a selected icon, search diagrams,
          and run snapshot actions.
        </DialogDescription>
        <Command
          value={state.nav.value}
          onValueChange={(value) => state.dispatch({ type: "setValue", value })}
          // Root filters through cmdk; every other page owns its own filtering,
          // for a different reason per page — mount cost for icons, substring
          // semantics for components, the server for diagrams.
          shouldFilter={state.page === "root"}
          onKeyDown={onKeyDown}
          className="bg-zinc-900 text-zinc-100"
          loop={false}
        >
          <div className="flex h-11 items-center gap-2 border-b border-zinc-700 px-3">
            {state.nav.stack.length > 1 && (
              <span className="shrink-0 rounded bg-zinc-700 px-1.5 py-0.5 text-[11px] font-medium text-zinc-200">
                {title}
              </span>
            )}
            <CommandPrimitive.Input
              autoFocus
              value={state.nav.query}
              onValueChange={(query) =>
                state.dispatch({ type: "setQuery", query })
              }
              placeholder={placeholder}
              className="h-full w-full bg-transparent text-sm outline-none placeholder:text-zinc-500"
            />
            {state.busy && (
              <Loader2 className="size-4 shrink-0 animate-spin text-zinc-400" />
            )}
          </div>

          <CommandList
            ref={listRef}
            // The scrollbar is styled explicitly: the UA default is a light
            // system bar that reads as a bright stripe down the side of a
            // zinc-900 panel.
            className="max-h-[340px] overflow-y-auto p-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-zinc-700 hover:scrollbar-thumb-zinc-600"
          >
            {state.page === "root" && (
              <>
                <CommandEmpty className="py-8 text-center text-sm text-zinc-500">
                  No matching command.
                </CommandEmpty>
                {grouped.map(([group, actions]) => (
                  <CommandGroup
                    key={group}
                    heading={group satisfies PaletteGroup}
                    className="cvm-palette-group text-zinc-100"
                  >
                    {actions.map((action) => (
                      <CommandItem
                        key={action.id}
                        value={action.id}
                        keywords={[action.label, action.hint]}
                        onSelect={() => state.runAction(action)}
                        className="gap-2 rounded px-2 py-1.5 text-sm text-zinc-200 data-[selected=true]:bg-zinc-700 data-[selected=true]:text-zinc-50"
                      >
                        <IconGlyph
                          name={action.icon}
                          className="size-4 text-zinc-400"
                        />
                        <span>{action.label}</span>
                        <span className="ml-auto text-[11px] text-zinc-500">
                          {/* `→` opens a further page, `⏎` fires immediately —
                              so Enter's effect is knowable before pressing it. */}
                          {action.opens ? (
                            "→"
                          ) : (
                            <CornerDownLeft className="size-3" />
                          )}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </>
            )}

            {isIconGrid && (
              <CommandGroup
                heading={
                  replacing
                    ? `Replacing “${replacing.props.name}” — ${state.icons.length} icons`
                    : `${state.icons.length} icons`
                }
                className="cvm-palette-group cvm-palette-grid cvm-palette-grid-10"
              >
                {state.icons.length === 0 && (
                  <p className="px-2 py-6 text-center text-sm text-zinc-500">
                    No icons match “{state.nav.query}”.
                  </p>
                )}
                {state.icons.map((name) => (
                  <CommandItem
                    key={name}
                    value={name}
                    onSelect={() =>
                      replacing
                        ? state.replaceIcon(name)
                        : state.insertIcon(name)
                    }
                    title={name}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded p-0 text-zinc-100 data-[selected=true]:bg-zinc-700 data-[selected=true]:text-white",
                      // The glyph already on the canvas, ringed: picking it is a
                      // no-op, and seeing which one it is beats guessing from a
                      // grid of 200 near-identical outlines.
                      name === replacing?.props.name && "ring-1 ring-zinc-500"
                    )}
                  >
                    {/* `text-current` is load-bearing: the shared CommandItem
                        base paints any descendant svg WITHOUT a `text-*` class
                        `text-muted-foreground`, which is what greyed every
                        glyph out regardless of the cell's own colour. */}
                    <IconGlyph name={name} className="size-6 text-current" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {state.page === "components" && (
              <CommandGroup
                heading="Components"
                className="cvm-palette-group cvm-palette-grid cvm-palette-grid-4"
              >
                {state.components.length === 0 && (
                  <p className="px-2 py-6 text-center text-sm text-zinc-500">
                    {state.nav.query
                      ? `No components match “${state.nav.query}”.`
                      : "No components yet — save a selection to make one."}
                  </p>
                )}
                {state.components.map((component) => (
                  <CommandItem
                    key={component.id}
                    value={component.id}
                    onSelect={() => void state.insertComponent(component)}
                    title={component.name}
                    className="group relative flex flex-col items-stretch gap-0 overflow-hidden rounded border border-zinc-700 bg-zinc-800 p-0 data-[selected=true]:border-zinc-300 data-[selected=true]:bg-zinc-700"
                  >
                    <ComponentCard component={component} />
                    <span className="absolute top-1 right-1 hidden gap-1 group-data-[selected=true]:flex">
                      <button
                        type="button"
                        aria-label={`Rename ${component.name}`}
                        title="Rename"
                        onClick={(e) => {
                          e.stopPropagation();
                          state.setComponentUnderEdit(component);
                          state.dispatch({
                            type: "push",
                            page: "renameComponent",
                          });
                        }}
                        className="rounded bg-zinc-950/80 p-1 text-zinc-300 hover:text-zinc-50"
                      >
                        <PenLine className="size-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${component.name}`}
                        title="Delete permanently"
                        onClick={(e) => {
                          e.stopPropagation();
                          void state.deleteComponent(component.id);
                        }}
                        className="rounded bg-zinc-950/80 p-1 text-zinc-300 hover:text-red-400"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {state.page === "diagrams" && (
              <CommandGroup
                heading={
                  state.searching
                    ? "Searching…"
                    : state.nav.query.trim()
                      ? "Diagrams"
                      : "Recent"
                }
                className="cvm-palette-group cvm-palette-grid cvm-palette-grid-3"
              >
                {state.diagramHits.length === 0 && !state.searching && (
                  <p className="px-2 py-6 text-center text-sm text-zinc-500">
                    {state.nav.query
                      ? `No diagrams match “${state.nav.query}”.`
                      : "No diagrams yet."}
                  </p>
                )}
                {state.diagramHits.map((hit) => {
                  const key = hit.snapshotId ?? `${hit.diagramId}:current`;
                  return (
                    <CommandItem
                      key={key}
                      value={key}
                      onSelect={() => void state.goToDiagram(hit)}
                      className="flex flex-col items-stretch gap-0 overflow-hidden rounded border border-zinc-700 bg-zinc-800 p-0 data-[selected=true]:border-zinc-300 data-[selected=true]:bg-zinc-700"
                    >
                      <DiagramCard hit={hit} query={state.nav.query} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {state.page === "nameComponent" && (
              <NamePage
                prompt="Press Enter to save the selection as"
                value={state.nav.query}
                onSubmit={() => void state.saveComponent(state.nav.query)}
              />
            )}

            {state.page === "renameComponent" && (
              <NamePage
                prompt="Press Enter to rename this component to"
                value={state.nav.query}
                onSubmit={() => {
                  const target = state.componentUnderEdit;
                  if (target)
                    void state.renameComponent(target.id, state.nav.query);
                }}
              />
            )}

            {state.page === "renameDiagram" && (
              <NamePage
                prompt="Press Enter to rename this diagram to"
                value={state.nav.query}
                onSubmit={() => void state.renameDiagram(state.nav.query)}
              />
            )}
          </CommandList>

          <div className="flex items-center gap-3 border-t border-zinc-700 px-3 py-1.5 text-[10px] text-zinc-500">
            <span>↑↓{columns ? "←→" : ""} navigate</span>
            <span>⏎ select</span>
            <span>{state.nav.stack.length > 1 ? "esc back" : "esc close"}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** The palette's own input doubles as the name field — one uninterrupted gesture. */
function NamePage({
  prompt,
  value,
  onSubmit,
}: {
  prompt: string;
  value: string;
  onSubmit: () => void;
}) {
  const trimmed = value.trim();
  return (
    <div className="px-3 py-6 text-sm text-zinc-400">
      {prompt} <span className="text-zinc-100">“{trimmed || "…"}”</span>
      <CommandItem
        value="__submit__"
        // An empty name blocks the save outright — no `Untitled N` auto-naming,
        // because a component is only ever findable by name.
        disabled={!trimmed}
        onSelect={onSubmit}
        // Plain white, selected or not. cmdk auto-selects the only item here,
        // and the shared base's `data-[selected=true]:text-accent-foreground`
        // wins over an unqualified colour — so both states are spelled out, or
        // the confirm button renders permanently dimmed.
        className="mt-3 justify-center rounded bg-white py-1.5 font-medium text-zinc-900 data-[selected=true]:bg-white data-[selected=true]:text-zinc-900 data-[disabled=true]:bg-zinc-700 data-[disabled=true]:text-zinc-300"
      >
        {trimmed ? "Confirm" : "Type a name first"}
      </CommandItem>
    </div>
  );
}
