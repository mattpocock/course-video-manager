/**
 * THE STILL QUEUE (#2323). The editor's Clip list shows every Clip's
 * first-frame still, and an uncached still takes the server 1.5-3.2 s to
 * decode. The app is plain HTTP/1.1, so the browser opens six connections to
 * it: forty `<img>`s asked for at once took all six and parked them in the
 * Still Gate's queue, and the Clip's `<video>` could not load until every
 * still had arrived.
 *
 * So a still only gets its `src` once the queue admits it, at most
 * {@link STILLS_IN_FLIGHT} at a time, in the order they asked. A waiting still
 * has sent no request, so it holds no connection: the rest are always free
 * for the Clip's `<video>`.
 *
 * A still is a `ticket`: one `<img>` asking for one URL. A ticket leaves the
 * queue when its image loads or fails, or when its `<img>` goes away.
 */
export const STILLS_IN_FLIGHT = 2;

export namespace stillQueueReducer {
  export type State = {
    /** Tickets whose `<img>` has its `src`, oldest first. */
    loading: readonly string[];
    /** Tickets waiting their turn, oldest first. */
    waiting: readonly string[];
    /** Tickets whose image has loaded or failed: they keep their `src`. */
    settled: readonly string[];
  };

  export type Action =
    | { type: "still-mounted"; ticket: string }
    | { type: "still-settled"; ticket: string }
    | { type: "still-unmounted"; ticket: string };
}

export const createInitialStillQueueState = (): stillQueueReducer.State => ({
  loading: [],
  waiting: [],
  settled: [],
});

/** Moves waiting tickets into the free slots. */
const admit = (state: stillQueueReducer.State): stillQueueReducer.State => {
  const free = Math.max(0, STILLS_IN_FLIGHT - state.loading.length);
  return {
    loading: [...state.loading, ...state.waiting.slice(0, free)],
    waiting: state.waiting.slice(free),
    settled: state.settled,
  };
};

const drop = (list: readonly string[], ticket: string) =>
  list.filter((t) => t !== ticket);

export const stillQueueReducer = (
  state: stillQueueReducer.State,
  action: stillQueueReducer.Action
): stillQueueReducer.State => {
  switch (action.type) {
    case "still-mounted":
      if (
        state.loading.includes(action.ticket) ||
        state.waiting.includes(action.ticket) ||
        state.settled.includes(action.ticket)
      ) {
        return state;
      }
      return admit({ ...state, waiting: [...state.waiting, action.ticket] });
    case "still-settled":
      // A settled still stays on screen; it only gives up its slot.
      if (!state.loading.includes(action.ticket)) return state;
      return admit({
        loading: drop(state.loading, action.ticket),
        waiting: state.waiting,
        settled: [...state.settled, action.ticket],
      });
    case "still-unmounted":
      return admit({
        loading: drop(state.loading, action.ticket),
        waiting: drop(state.waiting, action.ticket),
        settled: drop(state.settled, action.ticket),
      });
  }
};

/** Whether a ticket's `<img>` may have its `src` yet. */
export const isStillAdmitted = (
  state: stillQueueReducer.State,
  ticket: string
): boolean => state.loading.includes(ticket) || state.settled.includes(ticket);
