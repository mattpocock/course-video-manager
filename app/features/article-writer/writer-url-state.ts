import type { NavigateOptions } from "react-router";

export type WriterView = "writer" | "context" | "settings";

/** The open writer's sub-view. `null` means no writer is open for the field. */
export type WriterUrlState = {
  view: WriterView;
  ctxTab?: string;
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
 * `preventScrollReset` keeps the host page where the user left it. Pages here
 * scroll at the document level, and React Router's `<ScrollRestoration>` sends
 * any location it holds no saved position for straight to the top — which
 * every one of these updates is, since they replace the location. Applying the
 * writer's document closes it, so without this a save threw the page back to
 * the top (course-video-manager#1485).
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
