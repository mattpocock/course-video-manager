import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  selectWriterChatNotice,
  writerChatReducer,
} from "./writer-chat-reducer";

/** Above the chat: the Writer Chat loading, or a load or save that failed. */
export function WriterChatNotice({
  notice,
  dispatch,
}: {
  notice: ReturnType<typeof selectWriterChatNotice>;
  dispatch: (action: writerChatReducer.Action) => void;
}) {
  if (notice === null) return null;
  if (notice.kind === "loading") {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" />
        Loading the chat…
      </div>
    );
  }
  const loadFailed = notice.kind === "load-failed";
  return (
    <div
      role="alert"
      className="m-2 flex items-center justify-between gap-2 rounded-md border border-destructive p-2 text-sm text-destructive"
    >
      <span>
        {loadFailed ? "The chat did not load" : "The chat is not saved"}:{" "}
        {notice.message}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          dispatch({
            type: loadFailed ? "load-retry-clicked" : "save-retry-clicked",
          })
        }
      >
        Retry
      </Button>
    </div>
  );
}
