import {
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  PencilIcon,
  Trash2,
} from "lucide-react";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useFetcher } from "react-router";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { groupCommentsByParent } from "./animatic-lines";
import type {
  ClipMockupCommentEvent,
  ClipMockupCommentWriteResult,
} from "@/routes/api.clip-mockup-comments";

/**
 * Clip Mockup Comments in the Animatic's sidebar — the author's notes on one
 * moment or one Chapter, kept for the filming day, where the teleprompter
 * shows them under the line.
 *
 * LIKE A COMMENT IN A GOOGLE DOC. A row or a divider with comments carries an
 * amber badge with their count; one without shows a quiet "add" icon on hover
 * only. Either opens the thread in a popover, where a comment is added, edited
 * and deleted. A comment has no author: the CVM has no users.
 *
 * KEPT APART FROM THE ROWS. The page hands comments down through
 * `AnimaticCommentsProvider`, never folded into the Clip Mockups or Chapters,
 * so a new comment can never change the rows `useStableMockups` holds and so
 * can never remount the Player mid-watch.
 */

export interface AnimaticComment {
  readonly id: string;
  readonly clipMockupId: string | null;
  readonly clipMockupChapterId: string | null;
  readonly body: string;
}

export type AnimaticCommentTarget = Extract<
  ClipMockupCommentEvent,
  { type: "create" }
>["target"];

const NO_COMMENTS: readonly AnimaticComment[] = [];

const AnimaticCommentsContext = createContext<
  ReadonlyMap<string, readonly AnimaticComment[]>
>(new Map());

/** Every comment of the Video, for the threads anywhere below it. */
export function AnimaticCommentsProvider(props: {
  readonly comments: readonly AnimaticComment[];
  readonly children: ReactNode;
}) {
  const byParent = useMemo(
    () => groupCommentsByParent(props.comments),
    [props.comments]
  );
  return (
    <AnimaticCommentsContext.Provider value={byParent}>
      {props.children}
    </AnimaticCommentsContext.Provider>
  );
}

/** One place every write of a thread goes through. */
function useCommentWriter() {
  const fetcher = useFetcher<ClipMockupCommentWriteResult>();
  const submit = (event: ClipMockupCommentEvent) =>
    fetcher.submit(event, {
      method: "post",
      action: "/api/clip-mockup-comments",
      encType: "application/json",
    });
  const error =
    fetcher.state === "idle" && fetcher.data && !fetcher.data.ok
      ? fetcher.data.message
      : null;
  return { submit, error, busy: fetcher.state !== "idle" };
}

/**
 * The badge (or the hover-only add icon) and the thread behind it. The caller
 * places it: it is drawn beside the row's own button, never inside it, since a
 * button cannot hold another.
 */
export function AnimaticCommentThread(props: {
  readonly target: AnimaticCommentTarget;
  readonly className?: string;
}) {
  const comments =
    useContext(AnimaticCommentsContext).get(props.target.id) ?? NO_COMMENTS;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const writer = useCommentWriter();

  const add = () => {
    if (draft.trim() === "") return;
    writer.submit({ type: "create", target: props.target, body: draft.trim() });
    setDraft("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            comments.length > 0
              ? `${comments.length} comment${comments.length === 1 ? "" : "s"}`
              : "Add a comment"
          }
          className={cn(
            "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] tabular-nums",
            comments.length > 0
              ? "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-400/15 dark:text-amber-300 dark:hover:bg-amber-400/25"
              : "text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100",
            props.className
          )}
        >
          {comments.length > 0 ? (
            <>
              <MessageSquare className="size-3" />
              {comments.length}
            </>
          ) : (
            <MessageSquarePlus className="size-3.5" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-80 p-0">
        {comments.length > 0 && (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {comments.map((comment) => (
              <CommentItem key={comment.id} comment={comment} />
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 border-t border-border p-3 first:border-t-0">
          <Textarea
            autoFocus
            value={draft}
            placeholder="Add a comment for the filming day…"
            className="min-h-16 text-sm"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                add();
              }
            }}
          />
          {writer.error && (
            <p className="text-xs text-destructive">{writer.error}</p>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={draft.trim() === "" || writer.busy}
              onClick={add}
            >
              Comment
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface CommentAction {
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly onSelect: () => void;
  readonly destructive?: true;
}

/**
 * One comment, with the SAME ACTIONS on right-click and behind its `…`
 * button: edit first, delete last and on its own.
 */
function CommentItem(props: { readonly comment: AnimaticComment }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.comment.body);
  const writer = useCommentWriter();

  const save = () => {
    const body = draft.trim();
    if (body === "") return;
    if (body !== props.comment.body) {
      writer.submit({ type: "update", commentId: props.comment.id, body });
    }
    setEditing(false);
  };

  const groups: readonly (readonly CommentAction[])[] = [
    [
      {
        label: "Edit",
        icon: PencilIcon,
        // The draft starts from the body as it is NOW, which a poll may have
        // changed since this comment first rendered.
        onSelect: () => {
          setDraft(props.comment.body);
          setEditing(true);
        },
      },
    ],
    [
      {
        label: "Delete",
        icon: Trash2,
        destructive: true,
        onSelect: () =>
          writer.submit({ type: "delete", commentId: props.comment.id }),
      },
    ],
  ];

  if (editing) {
    return (
      <li className="flex flex-col gap-2 p-3">
        <Textarea
          autoFocus
          value={draft}
          className="min-h-16 text-sm"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDraft(props.comment.body);
              setEditing(false);
            }
          }}
        />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(props.comment.body);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button size="sm" disabled={draft.trim() === ""} onClick={save}>
            Save
          </Button>
        </div>
      </li>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li className="group/comment flex items-start gap-2 p-3 text-sm">
          <p className="min-w-0 flex-1 whitespace-pre-wrap">
            {props.comment.body}
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Comment actions"
                className="shrink-0 rounded-md p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/comment:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {groups.map((group, i) => [
                i > 0 && <DropdownMenuSeparator key={`sep-${i}`} />,
                <DropdownMenuGroup key={`group-${i}`}>
                  {group.map((action) => (
                    <DropdownMenuItem
                      key={action.label}
                      variant={action.destructive ? "destructive" : "default"}
                      onSelect={action.onSelect}
                    >
                      <action.icon className="size-4" />
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>,
              ])}
            </DropdownMenuContent>
          </DropdownMenu>
          {writer.error && (
            <p className="text-xs text-destructive">{writer.error}</p>
          )}
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {groups.map((group, i) => [
          i > 0 && <ContextMenuSeparator key={`sep-${i}`} />,
          <ContextMenuGroup key={`group-${i}`}>
            {group.map((action) => (
              <ContextMenuItem
                key={action.label}
                variant={action.destructive ? "destructive" : "default"}
                onSelect={action.onSelect}
              >
                <action.icon className="size-4" />
                {action.label}
              </ContextMenuItem>
            ))}
          </ContextMenuGroup>,
        ])}
      </ContextMenuContent>
    </ContextMenu>
  );
}
