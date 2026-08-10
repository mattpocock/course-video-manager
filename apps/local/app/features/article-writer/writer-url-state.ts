import type { NavigateOptions } from "react-router";
import type { WriterView } from "./types";

/**
 * The open writer's sub-view. `null` means no writer is open for the field.
 *
 * `ctxTab` is deliberately required rather than optional: `applyWriterUrlState`
 * clears the tab when it is `undefined`, so omitting it silently drops the
 * user's context tab. Every caller must say which it means.
 */
export type WriterUrlState = {
  view: WriterView;
  ctxTab: string | undefined;
} | null;

const FIELD_PARAM = "writer";
const VIEW_PARAM = "writerView";
const TAB_PARAM = "writerTab";

/**
 * How every writer URL update must navigate.
 *
 * `replace` keeps opening a panel out of the history stack — Back should leave
 * the page, not walk the writer's tabs.
 *
 * `preventScrollReset` tells React Router's `<ScrollRestoration>` (mounted in
 * `app/root.tsx`) not to send the window to the top on these replace-navigations.
 * Note that today every page hosting a writer scrolls inside a nested
 * `overflow-y-auto` container rather than the document, so this is belt-and-braces
 * — it matches how the rest of the app navigates (see
 * `_app.courses.$courseId.sections.$sectionId.tsx`, `teleprompter-settings.ts`)
 * and guards a page that later scrolls at the document level.
 */
export const WRITER_URL_UPDATE: NavigateOptions = {
  replace: true,
  preventScrollReset: true,
};

/** The writer state `params` holds for `fieldId`, if that field owns it. */
export function readWriterUrlState(
  params: URLSearchParams,
  fieldId: string
): WriterUrlState {
  if (params.get(FIELD_PARAM) !== fieldId) return null;
  const view = params.get(VIEW_PARAM);
  return {
    view: view === "context" || view === "settings" ? view : "writer",
    ctxTab: params.get(TAB_PARAM) ?? undefined,
  };
}

/**
 * `params` with `fieldId`'s writer state set to `state`. Closing clears the
 * sub-view too, so the next open starts on the writer rather than on whichever
 * context tab was last looked at.
 */
export function applyWriterUrlState(
  params: URLSearchParams,
  fieldId: string,
  state: WriterUrlState
): URLSearchParams {
  const next = new URLSearchParams(params);

  if (!state) {
    next.delete(FIELD_PARAM);
    next.delete(VIEW_PARAM);
    next.delete(TAB_PARAM);
    return next;
  }

  next.set(FIELD_PARAM, fieldId);
  // "writer" is the default, so it stays out of the URL.
  if (state.view === "writer") next.delete(VIEW_PARAM);
  else next.set(VIEW_PARAM, state.view);
  if (state.ctxTab === undefined) next.delete(TAB_PARAM);
  else next.set(TAB_PARAM, state.ctxTab);
  return next;
}
