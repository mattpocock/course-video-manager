import { useNavigate } from "react-router";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import {
  createInitialGlobalSearchState,
  globalSearchReducer,
} from "./global-search-reducer";

/** How long typing must pause before a search goes out. */
const SEARCH_DEBOUNCE_MS = 200;

/** Global Search's effect runner for `globalSearchReducer`. */
export function useGlobalSearchReducer() {
  const navigate = useNavigate();
  const [state, dispatch] = useEffectReducer<
    globalSearchReducer.State,
    globalSearchReducer.Action,
    globalSearchReducer.Effect
  >(globalSearchReducer, createInitialGlobalSearchState, {
    // Replaced by the next keystroke: the cleanup cancels the wait and the
    // request, so only the last query's search reaches the server.
    search: (_state, effect, dispatch) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        fetch(`/api/global-search?q=${encodeURIComponent(effect.query)}`, {
          signal: controller.signal,
        })
          .then(async (res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = (await res.json()) as {
              hits: globalSearchReducer.Hit[];
            };
            dispatch({
              type: "results-arrived",
              query: effect.query,
              hits: body.hits,
            });
          })
          .catch(() => {
            if (controller.signal.aborted) return;
            dispatch({ type: "search-failed", query: effect.query });
          });
      }, SEARCH_DEBOUNCE_MS);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    },
    navigate: (_state, effect) => {
      void navigate(effect.path);
    },
  });

  return { state, dispatch };
}
