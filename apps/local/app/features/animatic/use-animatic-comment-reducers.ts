import { useEffect } from "react";
import { useFetcher } from "react-router";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import { toast } from "@/components/ui/toast";
import type {
  ClipMockupCommentEvent,
  ClipMockupCommentWriteResult,
} from "@/routes/api.clip-mockup-comments";
import {
  animaticCommentEditReducer,
  createInitialAnimaticCommentEditState,
} from "./animatic-comment-edit-reducer";
import {
  animaticCommentThreadReducer,
  createInitialAnimaticCommentThreadState,
  selectThreadTarget,
  type AnimaticCommentTarget,
} from "./animatic-comment-thread-reducer";

/**
 * One place every write of a thread goes through. A fetcher, so the page's
 * loader revalidates and the thread shows the write; a refused write is
 * shown where it was made.
 */
function useCommentWriter() {
  const fetcher = useFetcher<ClipMockupCommentWriteResult>();
  // A refused write comes back as `fetcher.data` (`error` below); a rejected
  // submit never reached the action, so it is reported here.
  const submit = (event: ClipMockupCommentEvent) => {
    fetcher
      .submit(event, {
        method: "post",
        action: "/api/clip-mockup-comments",
        encType: "application/json",
      })
      .catch(() => {
        toast.error("Failed to save the comment");
      });
  };
  const error =
    fetcher.state === "idle" && fetcher.data && !fetcher.data.ok
      ? fetcher.data.message
      : null;
  return { submit, error, busy: fetcher.state !== "idle" };
}

/** A comment thread's effect runner for `animaticCommentThreadReducer`. */
export function useAnimaticCommentThreadReducer(props: {
  /** Held open by the caller; left out, the thread's own button opens it. */
  open: boolean | undefined;
  target: AnimaticCommentTarget;
}) {
  const writer = useCommentWriter();
  const [state, dispatch] = useEffectReducer<
    animaticCommentThreadReducer.State,
    animaticCommentThreadReducer.Action,
    animaticCommentThreadReducer.Effect
  >(animaticCommentThreadReducer, createInitialAnimaticCommentThreadState(), {
    "write-comment": (_state, effect) => writer.submit(effect.event),
  });

  const open = props.open ?? state.ownOpen;

  // Bridge: the thread showing or hiding, whoever holds it open. The target
  // is read only as it shows; that is the freeze.
  useEffect(() => {
    dispatch(
      open
        ? { type: "thread-shown", target: props.target }
        : { type: "thread-hidden" }
    );
  }, [dispatch, open]);

  return {
    state,
    dispatch,
    writer,
    open,
    target: selectThreadTarget(state, props.target),
  };
}

/** One comment's effect runner for `animaticCommentEditReducer`. */
export function useAnimaticCommentEditReducer() {
  const writer = useCommentWriter();
  const [state, dispatch] = useEffectReducer<
    animaticCommentEditReducer.State,
    animaticCommentEditReducer.Action,
    animaticCommentEditReducer.Effect
  >(animaticCommentEditReducer, createInitialAnimaticCommentEditState(), {
    "write-comment": (_state, effect) => writer.submit(effect.event),
  });
  return { state, dispatch, writer };
}
