import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { toast } from "@/components/ui/toast";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import {
  createInitialDeepLinkFocusState,
  deepLinkFocusReducer,
} from "./deep-link-focus-reducer";
import {
  ENTITY_LABELS,
  deepLinkTarget,
  type DeepLinkTargetType,
} from "./entity-deep-link";
import { after } from "@/packages/clock";

type Candidate = deepLinkFocusReducer.Candidate;

/** The DOM attribute a page puts on the element that shows a Candidate. */
export const DEEP_LINK_KEY_ATTR = "data-deep-link-key";

/** Spread onto the element that shows an item, so a link can scroll to it. */
export const deepLinkAnchor = (key: string) => ({ [DEEP_LINK_KEY_ATTR]: key });

const NOTICE_ID = "deep-link-notice";
const MAX_FRAMES = 60;

/**
 * Scroll the item into view and flash it once. Waits a few frames for it to
 * render: focusing may first open the tab or fold that holds it.
 */
function scrollToAnchor(key: string) {
  let frames = 0;
  const attempt = () => {
    const el = document.querySelector(
      `[${DEEP_LINK_KEY_ATTR}="${CSS.escape(key)}"]`
    );
    if (!el) {
      if (++frames < MAX_FRAMES) requestAnimationFrame(attempt);
      return;
    }
    el.scrollIntoView({ block: "center" });
    el.animate?.(
      [
        { boxShadow: "0 0 0 3px var(--ring)" },
        { boxShadow: "0 0 0 3px transparent" },
      ],
      { duration: 1600, easing: "ease-out" }
    );
  };
  requestAnimationFrame(attempt);
}

/**
 * Focus the item the page's URL links to (`?clip=…`, `?beat=…` and the rest
 * `entityDeepLink` writes): select it through `onFocus`, scroll it into view,
 * or say it is missing or archived. `types` are the items this part of the page
 * shows; `candidates` are those it has loaded right now. See
 * `deep-link-focus-reducer.ts` for the rules.
 */
export function useDeepLinkFocus(props: {
  types: ReadonlyArray<DeepLinkTargetType>;
  candidates: ReadonlyArray<Candidate>;
  onFocus?: (candidate: Candidate) => void;
}) {
  const { search } = useLocation();
  const onFocusRef = useRef(props.onFocus);
  onFocusRef.current = props.onFocus;

  const [, dispatch] = useEffectReducer(
    deepLinkFocusReducer,
    createInitialDeepLinkFocusState(),
    {
      "focus-deep-link-target": (_state, effect) => {
        toast.dismiss(NOTICE_ID);
        onFocusRef.current?.(effect.candidate);
        scrollToAnchor(effect.candidate.anchor ?? effect.candidate.key);
      },
      "show-deep-link-notice": (_state, effect) => {
        const label = ENTITY_LABELS[effect.target.type];
        const message =
          effect.reason === "archived"
            ? `The linked ${label} is archived.`
            : `The linked ${label} isn't here — it may have been deleted or archived.`;
        // On first load this runs before the root's <Toaster> has subscribed,
        // which would drop the toast; a task later it is listening.
        after(0, () =>
          toast.warning(message, { id: NOTICE_ID, duration: 10_000 })
        );
      },
    }
  );

  const target = deepLinkTarget(search, props.types);
  // A signature, so a page that rebuilds the same list every render does not
  // dispatch (and re-render) every render.
  const signature = props.candidates
    .map((c) => `${c.type}:${c.id}:${c.key}:${c.archived ? 1 : 0}`)
    .join("|");
  const targetKey = target ? `${target.type}:${target.id}` : "";
  const candidatesRef = useRef(props.candidates);
  candidatesRef.current = props.candidates;

  // Bridges the URL and the page's loaded items into the reducer.
  useEffect(() => {
    if (!target) return;
    dispatch({
      type: "deep-link-candidates-loaded",
      target,
      candidates: candidatesRef.current,
    });
  }, [targetKey, signature]);
}
