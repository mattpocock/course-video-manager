import { AlertTriangle, Link2, Pin } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const statusConfig = {
  disconnected: {
    label: "Not connected to a video editor",
    Icon: AlertTriangle,
    palette: "bg-amber-900/80 text-amber-300",
  },
  pinning: {
    label: "Diagram focused — snapshots will pin to clips ending now",
    Icon: Pin,
    palette: "bg-emerald-700/80 text-emerald-100",
  },
  connected: {
    label: "Connected to video editor — focus this window to pin snapshots",
    Icon: Link2,
    palette: "bg-zinc-700/80 text-zinc-300",
  },
};

export function ConnectionStatusIndicator({
  editorConnected,
  windowFocused,
}: {
  editorConnected: boolean;
  windowFocused: boolean;
}) {
  let status: "disconnected" | "connected" | "pinning";
  if (!editorConnected) {
    status = "disconnected";
  } else if (windowFocused) {
    status = "pinning";
  } else {
    status = "connected";
  }
  const { label, Icon, palette } = statusConfig[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          aria-label={label}
          className={
            "absolute bottom-28 right-2 z-50 flex h-9 w-9 items-center justify-center rounded-full shadow " +
            palette
          }
        >
          <Icon className="h-4 w-4" />
        </div>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}
