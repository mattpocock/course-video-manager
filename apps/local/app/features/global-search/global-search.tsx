import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Clapperboard,
  FileText,
  FolderGit2,
  Layers,
  Lightbulb,
  VideoIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useRef } from "react";
import { isGlobalSearchShortcut } from "./global-search-shortcut";
import {
  GROUP_HEADINGS,
  globalSearchGroups,
  type GlobalSearchGroup,
} from "./global-search-selectors";
import { useGlobalSearchReducer } from "./use-global-search-reducer";

const GROUP_ICONS: Record<GlobalSearchGroup, typeof VideoIcon> = {
  pitches: Lightbulb,
  videos: VideoIcon,
  shorts: Clapperboard,
  courses: FolderGit2,
  sections: Layers,
  lessons: FileText,
};

/** Opens Global Search; for the sidebar's Search button. */
const OpenGlobalSearchContext = createContext<() => void>(() => {});

export const useOpenGlobalSearch = () => useContext(OpenGlobalSearchContext);

/**
 * Global Search, mounted once in the app layout: the Ctrl/Cmd+K dialog that
 * finds any non-archived Course, Section, Lesson, Video or Pitch and opens it.
 * `children` can open it through `useOpenGlobalSearch`.
 */
export function GlobalSearchProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { state, dispatch } = useGlobalSearchReducer();
  const listRef = useRef<HTMLDivElement>(null);

  // Bridge: Ctrl/Cmd+K anywhere, the dialog's own input included. It also
  // keeps the browser's own Ctrl+K (its address-bar search) from running,
  // auto-repeats included; the reducer ignores those.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isGlobalSearchShortcut(e)) return;
      e.preventDefault();
      dispatch({ type: "shortcut-pressed", repeat: e.repeat });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  // Bridge: keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [state.highlighted]);

  const groups = globalSearchGroups(state);
  const hasRows = groups.length > 0;
  const hasQuery = state.query.trim() !== "";
  let index = 0;

  return (
    <OpenGlobalSearchContext.Provider
      value={() => dispatch({ type: "search-button-clicked" })}
    >
      {children}
      <CommandDialog
        open={state.open}
        onOpenChange={(open) => {
          if (!open) dispatch({ type: "dismissed" });
        }}
        title="Global Search"
        description="Find a Course, Section, Lesson, Video, Short or Pitch and open it."
        className="sm:max-w-2xl"
        commandProps={{
          // The server decides what matches, and the reducer which row is
          // highlighted: cmdk filters nothing and moves nothing itself.
          shouldFilter: false,
          value: String(state.highlighted),
          disablePointerSelection: true,
          vimBindings: false,
          onKeyDown: (e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              dispatch({
                type: "arrow-pressed",
                direction: e.key === "ArrowDown" ? "down" : "up",
              });
            } else if (e.key === "Enter") {
              e.preventDefault();
              dispatch({ type: "result-picked", index: state.highlighted });
            }
          },
        }}
      >
        <CommandInput
          placeholder="Search Courses, Lessons, Videos, Shorts, Pitches…"
          value={state.query}
          onValueChange={(query) => dispatch({ type: "query-typed", query })}
        />
        <CommandList ref={listRef} className="max-h-[60vh]">
          {!hasQuery && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Type to search. Ctrl+K or Escape closes.
            </p>
          )}
          {hasQuery && state.status === "searching" && (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              Searching…
            </p>
          )}
          {hasQuery && state.status === "done" && !hasRows && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No matches
            </p>
          )}
          {hasQuery && state.status === "failed" && (
            <p className="py-6 text-center text-sm text-destructive">
              Search failed. Type again to retry.
            </p>
          )}
          {hasQuery &&
            groups.map(({ group, rows }) => {
              const Icon = GROUP_ICONS[group];
              return (
                <CommandGroup key={group} heading={GROUP_HEADINGS[group]}>
                  {rows.map((row) => {
                    const rowIndex = index++;
                    return (
                      <CommandItem
                        key={`${row.hit.kind}:${row.hit.id}`}
                        value={String(rowIndex)}
                        onSelect={() =>
                          dispatch({ type: "result-picked", index: rowIndex })
                        }
                        className="items-start hover:bg-accent/50"
                      >
                        <Icon className="mt-0.5 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{row.title}</div>
                          {row.context !== null && (
                            <div className="truncate text-xs text-muted-foreground">
                              {row.context}
                            </div>
                          )}
                          {row.snippet !== null && (
                            <div className="line-clamp-2 text-xs text-muted-foreground">
                              {row.snippet}
                            </div>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
        </CommandList>
      </CommandDialog>
    </OpenGlobalSearchContext.Provider>
  );
}
