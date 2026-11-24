import { CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

/**
 * The command that remounts an Offline Storage Root, as a code block Matt can
 * copy and paste into WSL. The toast is the "copied" flash, so this holds no
 * state.
 */
export function RemountCommand(props: { command: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground break-all text-left">
        {props.command}
      </code>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          navigator.clipboard.writeText(props.command).then(
            () => toast.success("Remount command copied"),
            () => toast.error("Failed to copy the remount command")
          );
        }}
      >
        <CopyIcon className="size-3.5" />
        Copy
      </Button>
    </div>
  );
}
