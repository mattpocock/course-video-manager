import { useEffect, useId, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import {
  createInitialStillQueueState,
  isStillAdmitted,
  stillQueueReducer,
} from "../still-queue-reducer";

// One queue for the whole page: the browser's six connections are per origin,
// not per component.
let queue = createInitialStillQueueState();
const listeners = new Set<() => void>();

const dispatch = (action: stillQueueReducer.Action) => {
  const next = stillQueueReducer(queue, action);
  if (next === queue) return;
  queue = next;
  for (const listener of [...listeners]) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/**
 * A Clip still that waits its turn in the Still Queue before it asks the
 * server for anything, so stills never take the connections a Clip's
 * `<video>` needs (#2323). Until then it draws an empty box the same size.
 */
export const QueuedStill = (props: {
  src: string;
  alt: string;
  className?: string;
}) => {
  const ticket = `${useId()} ${props.src}`;

  // Bridges mount and unmount to the queue; it decides nothing.
  useEffect(() => {
    dispatch({ type: "still-mounted", ticket });
    return () => dispatch({ type: "still-unmounted", ticket });
  }, [ticket]);

  const admitted = useSyncExternalStore(
    subscribe,
    () => isStillAdmitted(queue, ticket),
    () => false
  );

  if (!admitted) {
    return <div className={cn(props.className, "bg-muted")} />;
  }

  const settled = () => dispatch({ type: "still-settled", ticket });
  return (
    <img
      src={props.src}
      alt={props.alt}
      className={props.className}
      onLoad={settled}
      onError={settled}
    />
  );
};
