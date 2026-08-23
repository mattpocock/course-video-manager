import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronDown,
  DownloadIcon,
  FilmIcon,
  RefreshCwIcon,
  SendIcon,
} from "lucide-react";
import {
  CopySubmenu,
  CopyVideoItem,
  RenameVideoItem,
  RevealInFileSystemItem,
} from "./shared-action-items";

export const StudioActionsDropdown = (props: {
  allClipsHaveSilenceDetected: boolean;
  allClipsHaveText: boolean;
  onExport: () => void;
  onRenderVertical?: () => void;
  onPostShorts?: () => void;
  onPostYoutube?: () => void;
  onPostTiktok?: () => void;
  videoId: string;
  isCopied: boolean;
  copyTranscriptToClipboard: () => void;
  youtubeChapters: { timestamp: string; name: string }[];
  isChaptersCopied: boolean;
  copyYoutubeChaptersToClipboard: () => void;
  /** Re-transcribe every Clip in THIS Video, in one pass (#1571) */
  onRetranscribeAllClips: () => void;
  onRenameVideoClick: () => void;
  onCopyVideoClick: () => void;
  onRevealInFileSystem?: () => void;
  isLogPathCopied: boolean;
  copyLogPathToClipboard: () => void;
}) => {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                disabled={!props.allClipsHaveSilenceDetected}
              >
                Actions
                <ChevronDown className="w-4 h-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        {!props.allClipsHaveSilenceDetected && (
          <TooltipContent>
            <p>Waiting for silence detection to complete</p>
          </TooltipContent>
        )}
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={props.onRetranscribeAllClips}>
          <RefreshCwIcon className="w-4 h-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Re-transcribe all clips</span>
            <span className="text-xs text-muted-foreground">
              Transcribe every clip in this video again, with word timing
            </span>
          </div>
        </DropdownMenuItem>

        {props.onRenderVertical && (
          <DropdownMenuItem onSelect={props.onRenderVertical}>
            <FilmIcon className="w-4 h-4 mr-2" />
            <div className="flex flex-col">
              <span className="font-medium">Render Vertical Short</span>
              <span className="text-xs text-muted-foreground">
                Render a captioned 9:16 short from this video
              </span>
            </div>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem
          disabled={!props.onPostShorts}
          onSelect={props.onPostShorts}
        >
          <SendIcon className="w-4 h-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Post Short</span>
            <span className="text-xs text-muted-foreground">
              Post to YouTube Shorts + TikTok
            </span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem
          disabled={!props.onPostYoutube}
          onSelect={props.onPostYoutube}
        >
          <SendIcon className="w-4 h-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Post to YouTube</span>
            <span className="text-xs text-muted-foreground">
              Upload as a YouTube Short
            </span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem
          disabled={!props.onPostTiktok}
          onSelect={props.onPostTiktok}
        >
          <SendIcon className="w-4 h-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Post to TikTok</span>
            <span className="text-xs text-muted-foreground">
              Post to TikTok via Buffer
            </span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <CopySubmenu
          allClipsHaveText={props.allClipsHaveText}
          isCopied={props.isCopied}
          copyTranscriptToClipboard={props.copyTranscriptToClipboard}
          youtubeChapters={props.youtubeChapters}
          isChaptersCopied={props.isChaptersCopied}
          copyYoutubeChaptersToClipboard={props.copyYoutubeChaptersToClipboard}
          isLogPathCopied={props.isLogPathCopied}
          copyLogPathToClipboard={props.copyLogPathToClipboard}
        />

        <DropdownMenuItem onSelect={props.onExport}>
          <DownloadIcon className="w-4 h-4 mr-2" />
          <div className="flex flex-col">
            <span className="font-medium">Export</span>
            <span className="text-xs text-muted-foreground">
              Export video clips to file
            </span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <RenameVideoItem onRenameVideoClick={props.onRenameVideoClick} />

        <CopyVideoItem onCopyVideoClick={props.onCopyVideoClick} />

        {props.onRevealInFileSystem && (
          <RevealInFileSystemItem
            onRevealInFileSystem={props.onRevealInFileSystem}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
