import { useEffect, useRef } from "react";
import { MessageSquareIcon, RadioIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatView } from "./chat-view";
import {
  BADGE_LABELS,
  authorColor,
  rowAge,
  rowBadge,
  type RowBadge,
} from "./chat-presenter";

/**
 * The pop-out live chat as a presenter view (#2590): what Matt reads on a
 * second screen while live. Always the dark glass, like the teleprompter;
 * type scales with the window, from a 480px pop-out to a full-screen monitor.
 * The newest message is brightest, the one on the stream wears amber, and a
 * click reports the message to the Streaming tab, which decides.
 */

/** Rows step back as they age, so the eye lands on the newest. */
const AGE_OPACITY = ["opacity-100", "opacity-80", "opacity-65", "opacity-50"];

/** Padding either side, scaling with the window. */
const GUTTER = "px-[clamp(0.75rem,2.5vw,3rem)]";

const Banner = (props: { warn: boolean; children: React.ReactNode }) => (
  <p
    className={cn(
      "rounded-lg border px-4 py-2 text-[clamp(0.875rem,1.2vw,1.25rem)] leading-snug",
      props.warn
        ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
        : "border-white/10 bg-white/5 text-white/70"
    )}
  >
    {props.children}
  </p>
);

const Badge = (props: { badge: Exclude<RowBadge, null> }) => (
  <span
    className={cn(
      "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 font-bold uppercase tracking-wider",
      "text-[clamp(0.6875rem,0.9vw,1rem)]",
      props.badge === "on-stream"
        ? "bg-amber-400 text-neutral-950"
        : "border border-amber-400/70 text-amber-300 animate-pulse motion-reduce:animate-none"
    )}
  >
    {props.badge === "on-stream" && <RadioIcon className="size-[1.1em]" />}
    {BADGE_LABELS[props.badge]}
  </span>
);

const Placeholder = (props: { children: React.ReactNode }) => (
  <div className="flex flex-1 items-center justify-center px-8 text-center">
    <p className="max-w-xl text-[clamp(1.125rem,2vw,2rem)] text-white/40">
      {props.children}
    </p>
  </div>
);

/** The connection line, the notices, and whether the Streaming tab is there. */
const StatusBanners = (props: { view: ChatView | null; attached: boolean }) => {
  const line = props.view?.line ?? null;
  const notices = props.view?.notices ?? [];
  if (props.attached && !line && notices.length === 0) return null;
  return (
    <div className={cn("flex shrink-0 flex-col gap-2 pt-3", GUTTER)}>
      {!props.attached && (
        <Banner warn>
          Open the Streaming tab: this window shows its chat.
        </Banner>
      )}
      {line && <Banner warn={line.warn}>{line.text}</Banner>}
      {notices.map((notice) => (
        <Banner key={notice} warn>
          <span data-testid="chat-notice">{notice}</span>
        </Banner>
      ))}
    </div>
  );
};

/** One message: author above text, dimmed by age, amber while on stream. */
const PresenterRow = (props: {
  row: ChatView["rows"][number];
  age: 0 | 1 | 2 | 3;
  onClick: () => void;
}) => {
  const { row, age } = props;
  const badge = rowBadge(row);
  return (
    <li className="mx-auto w-full max-w-[90rem] animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none">
      <button
        type="button"
        aria-pressed={row.highlighted}
        title={
          row.highlighted
            ? "On the stream: click to hide it"
            : "Click to show it on the stream"
        }
        onClick={props.onClick}
        className={cn(
          "w-full rounded-xl text-left transition-[opacity,background-color] duration-500",
          "px-[clamp(0.75rem,1.5vw,1.5rem)] py-[clamp(0.5rem,1vw,1rem)]",
          "hover:bg-white/[0.06] hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
          AGE_OPACITY[age],
          age === 0 && "bg-white/[0.07]",
          row.highlighted &&
            "bg-amber-400/15 opacity-100 ring-2 ring-amber-400 hover:bg-amber-400/20",
          badge === "showing" &&
            "opacity-100 outline-2 outline-dashed outline-amber-400/70"
        )}
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={cn(
              "min-w-0 font-semibold [overflow-wrap:anywhere]",
              "text-[clamp(0.875rem,1.4vw,1.5rem)]",
              authorColor(row.author)
            )}
          >
            {row.author}
          </span>
          {badge && <Badge badge={badge} />}
        </span>
        <span className="mt-1 block whitespace-pre-wrap font-medium leading-snug text-white [overflow-wrap:anywhere] text-[clamp(1.25rem,2.4vw,2.5rem)]">
          {row.text}
        </span>
      </button>
    </li>
  );
};

export const StreamChatPresenter = (props: {
  /** The chat as the Streaming tab last sent it; null before it has. */
  view: ChatView | null;
  /** The Streaming tab answered lately. */
  attached: boolean;
  onMessageClicked: (messageId: string) => void;
}) => {
  const bottom = useRef<HTMLLIElement>(null);
  const rows = props.view?.rows ?? [];

  // Keeps the newest message in view; the list's CSS makes it glide, unless
  // the presenter asked for reduced motion.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [rows.length]);

  return (
    <div
      className="fixed inset-0 flex flex-col bg-neutral-950 text-white [color-scheme:dark]"
      data-testid="stream-chat-popout"
    >
      <header
        className={cn(
          "flex shrink-0 items-center gap-3 border-b border-white/10 py-3",
          GUTTER
        )}
      >
        <MessageSquareIcon className="size-5 text-white/50" />
        <h1 className="text-[clamp(1rem,1.2vw,1.25rem)] font-semibold text-white/80">
          Live chat
        </h1>
        <span className="ml-auto flex min-w-0 items-center gap-2 text-[clamp(0.75rem,1vw,1rem)] text-white/50">
          <span
            aria-hidden
            className={cn(
              "size-2.5 shrink-0 rounded-full",
              props.attached ? "bg-emerald-400" : "bg-amber-400"
            )}
          />
          <span className="truncate">
            {props.attached
              ? "Click a message to show it on stream"
              : "Streaming tab not open"}
          </span>
        </span>
      </header>

      <StatusBanners view={props.view} attached={props.attached} />

      {!props.view ? (
        <Placeholder>Waiting for the Streaming tab…</Placeholder>
      ) : props.view.waiting ? (
        <Placeholder>No messages yet.</Placeholder>
      ) : (
        <ul
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-[clamp(0.25rem,0.6vw,0.75rem)] overflow-y-auto py-4",
            "scroll-smooth motion-reduce:scroll-auto",
            GUTTER
          )}
        >
          {/* Sits a short chat at the bottom, where the newest is read. */}
          <li aria-hidden className="mt-auto" />
          {rows.map((row, index) => (
            <PresenterRow
              key={row.id}
              row={row}
              age={rowAge(index, rows.length)}
              onClick={() => props.onMessageClicked(row.id)}
            />
          ))}
          <li ref={bottom} aria-hidden />
        </ul>
      )}
    </div>
  );
};
