/**
 * The glass while the editor's Suggestions tab is open: the suggested line,
 * with the transcripts of the Clips just before it dimmed above it, so you can
 * see where you are without reading them aloud.
 *
 * A new suggestion scrolls so the line sits in the middle of the glass, and it
 * stays there as it streams in. The Stream Deck still nudges it, and reset
 * centres it again.
 */
import { useLayoutEffect, useRef } from "react";
import type { teleprompterSession } from "./teleprompter-session";
import { ScriptMarkdown } from "./script-markdown";
import { TYPE, textStyle } from "./teleprompter-settings";
import { useTeleprompterActions } from "./use-teleprompter-actions";

export function SuggestionGlass(props: {
  suggestion: teleprompterSession.Suggestion;
}) {
  const { suggestion } = props;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  const centre = () => {
    const scroller = scrollerRef.current;
    const line = lineRef.current;
    if (!scroller || !line) return;
    const lineBox = line.getBoundingClientRect();
    const scrollerBox = scroller.getBoundingClientRect();
    scroller.scrollTo({
      top:
        scroller.scrollTop +
        (lineBox.top - scrollerBox.top) +
        lineBox.height / 2 -
        scroller.clientHeight / 2,
    });
  };

  // Bridge to the DOM: a new suggestion, or more of one, is centred.
  useLayoutEffect(centre, [suggestion.id, suggestion.text]);

  const nudge = TYPE.fontSize * TYPE.lineHeight * 3;
  useTeleprompterActions({
    advance: () =>
      scrollerRef.current?.scrollBy({ top: nudge, behavior: "smooth" }),
    back: () =>
      scrollerRef.current?.scrollBy({ top: -nudge, behavior: "smooth" }),
    reset: centre,
  });

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <div
        ref={scrollerRef}
        data-suggestion-scroller
        className="absolute inset-0 overflow-y-auto [scrollbar-width:none]"
      >
        <div
          className="mx-auto"
          style={{
            ...textStyle(),
            width: `${TYPE.measure}ch`,
            maxWidth: "92vw",
          }}
        >
          {/* Room above and below, so any line can reach the middle. */}
          <div style={{ height: "50vh" }} />
          {suggestion.previousClips.map((clip, i) => (
            <p
              key={i}
              data-previous-clip
              className="mb-6 whitespace-pre-wrap"
              style={{
                fontSize: `${TYPE.cueScale}em`,
                color: TYPE.cueColor,
                opacity: 0.6,
              }}
            >
              {clip}
            </p>
          ))}
          <div ref={lineRef} className="mt-10">
            {suggestion.text ? (
              <ScriptMarkdown>{suggestion.text}</ScriptMarkdown>
            ) : (
              <span className="text-white/35">
                Thinking of what to say next…
              </span>
            )}
          </div>
          <div style={{ height: "50vh" }} />
        </div>
      </div>
    </div>
  );
}
