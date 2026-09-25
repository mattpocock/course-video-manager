import { Player, type PlayerRef } from "@remotion/player";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { AnimaticChapterDivider } from "./animatic-chapter-divider";
import {
  buildAnimaticChapterLayout,
  type AnimaticChapter,
  type AnimaticChapterRow,
} from "./animatic-chapters";
import {
  areAllChaptersCollapsed,
  expandChapterAtPlayhead,
  hiddenRowIndices,
  toggleAllChapters,
  toggleChapter,
  type AnimaticCollapseState,
} from "./animatic-collapse";
import {
  AnimaticComposition,
  type AnimaticCompositionProps,
} from "./animatic-composition";
import {
  ANIMATIC_PLAYBACK_RATES,
  useAnimaticPlaybackRate,
} from "./animatic-playback-rate";
import {
  moveSelection,
  resolveSelection,
  selectEdge,
  type AnimaticSelection,
} from "./animatic-selection";
import { useStableChapters, useStableMockups } from "./animatic-revalidation";
import { useAnimaticShortcuts } from "./use-animatic-shortcuts";
import {
  ANIMATIC_FPS,
  buildAnimaticTimeline,
  formatRunTime,
  segmentIndexAtFrame,
  type AnimaticClipMockup,
} from "./animatic-timeline";

/**
 * The Animatic as the author watches it — a Video's Clip Mockups played in
 * order, from the student's seat. It fills whatever the Video's layout gives
 * it, so the page keeps its header and its PREVIOUS/NEXT.
 *
 * IT IS THE VIDEO PAGE, WITH STILLS. Same shape — the list of moments on the
 * LEFT, the picture on the right — and the same keys, because the author walks
 * an Animatic with exactly the habit he walks a filmed Video with. SPACE plays
 * and pauses, RETURN plays the selected moment from its start, ARROW UP and
 * ARROW DOWN move the selection without touching playback. See
 * `use-animatic-shortcuts.ts`. A CLICK on a Clip Mockup plays it at once,
 * rather than the Video page's select-then-click-again: there is no per-frame
 * editing to select for here, so the second click had nothing to do.
 *
 * Three things beyond plain playback, all of them there because of what the
 * author does next. The POSITION shows in a corner the whole time, because the
 * feedback he gives is "number 14 is too dense" and he cannot count frames
 * back afterwards. The LIST jumps, because a note is written by re-watching
 * one moment, not by scrubbing for it. The RUN TIME shows, because the point
 * of an Animatic is knowing a Lesson runs thirty-four minutes before anything
 * is filmed.
 *
 * The SPEED is a fourth: it starts at two times, it has a control of its own
 * in the bar, and the choice follows the author to the next Animatic. See
 * `animatic-playback-rate.ts` for why.
 *
 * The Video's Clip Mockup Chapters are DIVIDERS IN THAT LIST, and nothing more:
 * each one carries the count and the run time of the rows under it, and seeks to
 * the first of them. No Chapter is a segment, so the clock, the frame and the
 * position badge do not know they exist. See `animatic-chapters.ts`.
 *
 * A divider also FOLDS ITS ROWS AWAY, which is the reason Chapters exist: a
 * settled Playthrough of twenty rows goes behind one title, and the two moments
 * still being judged sit next to each other. Collapsing hides rows and never
 * skips frames, and the ARROW keys step over a folded Chapter's rows rather than
 * walking a selection the author cannot see. See `animatic-collapse.ts`.
 */

export const AnimaticPlayer = (props: {
  mockups: AnimaticClipMockup[];
  /** The Video's Clip Mockup Chapters. Empty for a Video nobody has divided. */
  chapters: AnimaticChapter[];
  width: number;
  height: number;
}) => {
  const playerRef = useRef<PlayerRef>(null);
  const [playbackRate, choosePlaybackRate] = useAnimaticPlaybackRate();
  const [selection, setSelection] = useState<AnimaticSelection>(null);

  // THE SEGMENT IS STATE, NOT THE FRAME. Holding the raw frame re-rendered this
  // page thirty times a second for a highlight that moves once per Clip Mockup;
  // holding the index means React bails out on every frame that did not cross a
  // boundary. The page polls its own loader (see `animatic-revalidation.ts`), so
  // a re-render here is no longer a rare event and cannot be a cheap one.
  const [activeIndex, setActiveIndex] = useState(0);

  // The rows as an unchanged poll leaves them: the SAME array, so nothing below
  // sees a change and the Player is never remounted mid-watch.
  const mockups = useStableMockups(props.mockups);
  const chapters = useStableChapters(props.chapters);

  const timeline = useMemo(() => buildAnimaticTimeline(mockups), [mockups]);

  // The dividers, with what they roll up. Pure arithmetic over the same
  // segments the Player plays — no Chapter is a segment of its own.
  const layout = useMemo(
    () => buildAnimaticChapterLayout({ segments: timeline.segments, chapters }),
    [timeline, chapters]
  );

  // Which dividers are folded away. EPHEMERAL, keyed by Chapter id: it is born
  // empty on every load, exactly as the Clip timeline's is. See
  // `animatic-collapse.ts`.
  const [collapsed, setCollapsed] = useState<AnimaticCollapseState>({});
  const chapterIds = useMemo(
    () => layout.sections.map((section) => section.chapter.id),
    [layout]
  );
  const allCollapsed = areAllChaptersCollapsed(collapsed, chapterIds);
  // The rows a fold has taken off the screen. The keys read it so that they
  // cannot select a row the author cannot see.
  const hiddenIndices = useMemo(
    () => hiddenRowIndices({ collapsed, sections: layout.sections }),
    [collapsed, layout]
  );
  const toggleAll = () =>
    setCollapsed((prev) => toggleAllChapters(prev, chapterIds));

  // Read by the frameupdate listener, which is installed once. A new timeline
  // (an agent added a line while this played) must not re-install it.
  const segmentsRef = useRef(timeline.segments);
  segmentsRef.current = timeline.segments;

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrameUpdate = (event: { detail: { frame: number } }) =>
      setActiveIndex(
        segmentIndexAtFrame(segmentsRef.current, event.detail.frame)
      );
    player.addEventListener("frameupdate", onFrameUpdate);
    return () => player.removeEventListener("frameupdate", onFrameUpdate);
  }, []);

  // The control in the bar owns the Player's own rate; this is how the choice
  // made there gets written down. Storing the rate the Player reports, rather
  // than the rate a click asked for, keeps the two from drifting apart.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onRateChange = (event: { detail: { playbackRate: number } }) =>
      choosePlaybackRate(event.detail.playbackRate);
    player.addEventListener("ratechange", onRateChange);
    return () => player.removeEventListener("ratechange", onRateChange);
  }, [choosePlaybackRate]);

  const count = timeline.segments.length;
  const selectedIndex = resolveSelection(selection, activeIndex);

  /** Select a Clip Mockup and play it from its own first frame. */
  const playFrom = useCallback(
    (index: number) => {
      const segment = segmentsRef.current[index];
      if (!segment) return;
      setSelection(index);
      playerRef.current?.seekTo(segment.startFrame);
      playerRef.current?.play();
    },
    // `segmentsRef` and `playerRef` are refs, so this is stable for the life of
    // the page — a poll cannot replace the click handler on every row.
    []
  );

  useAnimaticShortcuts({
    onTogglePlay: () => playerRef.current?.toggle(),
    onPlaySelected: () => {
      if (selectedIndex < 0) return;
      // Already watching the selected moment: RETURN is a plain play/pause
      // there, exactly as it is on the Video page, instead of restarting it.
      if (selectedIndex === activeIndex) {
        playerRef.current?.toggle();
        return;
      }
      playFrom(selectedIndex);
    },
    onMoveSelection: (delta) =>
      setSelection(
        moveSelection({ selection, activeIndex, delta, count, hiddenIndices })
      ),
    onSelectEdge: (edge) =>
      // `null` is "nothing on screen to select", so the selection stands.
      setSelection(
        (prev) => selectEdge({ edge, count, hiddenIndices }) ?? prev
      ),
    onChooseRate: (rate) => {
      // The Video page's L and K: at that rate already, the key is a play/pause.
      if (playbackRate === rate) {
        playerRef.current?.toggle();
        return;
      }
      choosePlaybackRate(rate);
      playerRef.current?.play();
    },
  });

  // THE LIST NEVER HIDES THE ROW BEING HEARD. A Chapter the author folded away
  // opens itself the moment the Animatic plays into it — the Clip timeline does
  // the same for the Clip being edited. The helper hands back the very same
  // state when nothing changed, so a segment boundary inside an open Chapter
  // costs no re-render.
  //
  // IT FIRES ON A PLAYHEAD MOVE, NEVER ON A DATA CHANGE. The sections are read
  // through a ref, so `layout` is not a dependency: an edit by the authoring
  // agent — one new line, one renamed Chapter — mints a new `layout` while the
  // playhead stands still, and re-running this effect there would re-open the
  // Chapter the author has just folded away. He folds a settled Playthrough,
  // the agent adds a row somewhere else, and the fold undoes itself.
  const sectionsRef = useRef(layout.sections);
  sectionsRef.current = layout.sections;

  useEffect(() => {
    setCollapsed((prev) =>
      expandChapterAtPlayhead({
        collapsed: prev,
        sections: sectionsRef.current,
        activeIndex,
      })
    );
  }, [activeIndex]);

  // Keep the selected row in sight. While the author has made no choice of his
  // own the selection follows the playhead, so this is also what makes the list
  // walk itself down as the Animatic plays.
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const row = listRef.current?.querySelector(
      `[data-animatic-index="${selectedIndex}"]`
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const active = activeIndex >= 0 ? timeline.segments[activeIndex] : undefined;

  const broken = mockups.filter((m) => m.imageMissing || m.audioMissing);

  // Memoised on the timeline alone: a poll that changed nothing hands the
  // Player the very same object, and the composition is not rebuilt.
  const inputProps: AnimaticCompositionProps = useMemo(
    () => ({ segments: [...timeline.segments] }),
    [timeline]
  );

  /**
   * One Clip Mockup's row. The same row whether it sits under a divider or
   * above the first one: the number on it is its position in the Animatic, and
   * `data-animatic-index` is its index in the timeline, so a Chapter changes
   * neither the count nor what a key walks.
   */
  const renderRow = ({ segment, index }: AnimaticChapterRow) => (
    <li key={segment.mockup.id}>
      <button
        type="button"
        data-animatic-index={index}
        // A clicked row keeps the keys working: the shared guard ignores a
        // keydown on a plain button, and the author's next act after clicking a
        // moment is SPACE.
        className={cn(
          "allow-keydown flex w-full gap-3 border-b border-white/5 px-4 py-2.5 text-left text-sm hover:bg-white/10",
          index === activeIndex && "bg-white/15",
          index === selectedIndex && index !== activeIndex && "bg-white/10",
          index === selectedIndex && "ring-1 ring-inset ring-sky-400/60"
        )}
        onClick={() => playFrom(index)}
      >
        <span className="w-7 shrink-0 font-mono text-xs tabular-nums text-white/50">
          {segment.mockup.position}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block whitespace-pre-wrap">
            {segment.mockup.line}
          </span>
          <span className="mt-0.5 block font-mono text-[11px] text-white/40">
            {formatRunTime(segment.startFrame / ANIMATIC_FPS)}
            {(segment.mockup.imageMissing || segment.mockup.audioMissing) && (
              <span className="text-amber-300"> · file missing</span>
            )}
          </span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="flex h-full w-full min-h-0 bg-black text-white">
      <aside className="flex w-96 shrink-0 flex-col border-r border-white/10 bg-neutral-950">
        <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Clip Mockups</div>
            <div className="text-xs text-white/60">
              {count} in {formatRunTime(timeline.totalSeconds)}
            </div>
          </div>

          {/* One control for the lot, and the SAME PAIR OF ICONS the Clip
              timeline uses, so it reads as the same control. A Video nobody has
              divided has nothing to fold, so it has no button either. */}
          {chapterIds.length > 0 && (
            <button
              type="button"
              // A clicked control keeps the keys working, exactly as a row does.
              className="allow-keydown shrink-0 rounded-md p-1 text-white/40 hover:bg-white/10 hover:text-white"
              onClick={toggleAll}
              aria-label={
                allCollapsed ? "Expand all chapters" : "Collapse all chapters"
              }
            >
              {allCollapsed ? (
                <ChevronsUpDown className="size-3" />
              ) : (
                <ChevronsDownUp className="size-3" />
              )}
            </button>
          )}
        </header>

        {broken.length > 0 && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            <div className="font-semibold">
              {broken.length} Clip Mockup{broken.length === 1 ? "" : "s"} cannot
              play in full
            </div>
            <ul className="mt-1 space-y-0.5">
              {broken.map((m) => (
                <li key={m.id}>
                  #{m.position}:{" "}
                  {[
                    m.imageMissing ? "frame file missing" : null,
                    m.audioMissing ? "speech file missing" : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}

        <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {/* Above the first divider: plain rows, with no invented heading. */}
          {layout.leadingRows.map(renderRow)}
          {layout.sections.map((section) => (
            <Fragment key={section.chapter.id}>
              {/* Sticky on the row, not the button: the row is the scrolling
                  list's own child, so this is what can stay in sight. */}
              <li className="sticky top-0 z-10">
                <AnimaticChapterDivider
                  name={section.chapter.name}
                  mockupCount={section.mockupCount}
                  runTimeSeconds={section.runTimeSeconds}
                  onClick={
                    section.seekIndex === null
                      ? undefined
                      : () => playFrom(section.seekIndex!)
                  }
                  isCollapsed={collapsed[section.chapter.id] ?? false}
                  onToggleCollapse={() =>
                    setCollapsed((prev) =>
                      toggleChapter(prev, section.chapter.id)
                    )
                  }
                />
              </li>
              {/* Folded away: the rows are not drawn. The count and the run
                  time are the divider's own, so it reads the same closed as
                  open, and the clock never knew about any of this. */}
              {!collapsed[section.chapter.id] && section.rows.map(renderRow)}
            </Fragment>
          ))}
        </ol>
      </aside>

      <div className="relative flex-1 min-w-0">
        <Player
          ref={playerRef}
          component={AnimaticComposition}
          inputProps={inputProps}
          fps={ANIMATIC_FPS}
          durationInFrames={timeline.durationInFrames}
          compositionWidth={props.width}
          compositionHeight={props.height}
          style={{ width: "100%", height: "100%" }}
          controls
          playbackRate={playbackRate}
          showPlaybackRateControl={ANIMATIC_PLAYBACK_RATES}
          loop={false}
          clickToPlay
          // SPACE is ours, not the Player's — leaving both on toggles playback
          // twice whenever the Player holds focus, which is right after a click
          // on the picture.
          spaceKeyToPlayOrPause={false}
        />

        {/* The position, in a corner, throughout. */}
        {active && (
          <div className="pointer-events-none absolute left-4 top-4 rounded-md bg-black/70 px-3 py-1.5 font-mono text-sm tabular-nums tracking-wide">
            {active.mockup.position} / {count}
          </div>
        )}

        <div className="pointer-events-none absolute right-4 top-4 rounded-md bg-black/70 px-3 py-1.5 font-mono text-sm tabular-nums">
          {formatRunTime(timeline.totalSeconds)}
        </div>
      </div>
    </div>
  );
};
