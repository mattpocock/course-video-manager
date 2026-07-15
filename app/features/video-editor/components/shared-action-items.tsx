import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CheckIcon,
  CopyIcon,
  FolderOpen,
  PencilLineIcon,
  ScrollTextIcon,
} from "lucide-react";

export const CopySubmenu = (props: {
  allClipsHaveText: boolean;
  isCopied: boolean;
  copyTranscriptToClipboard: () => void;
  youtubeChapters: { timestamp: string; name: string }[];
  isChaptersCopied: boolean;
  copyYoutubeChaptersToClipboard: () => void;
  isLogPathCopied: boolean;
  copyLogPathToClipboard: () => void;
}) => (
  <DropdownMenuSub>
    <DropdownMenuSubTrigger>
      <CopyIcon className="w-4 h-4 mr-2" />
      Copy
    </DropdownMenuSubTrigger>
    <DropdownMenuSubContent className="w-64">
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <DropdownMenuItem
              disabled={!props.allClipsHaveText}
              onSelect={props.copyTranscriptToClipboard}
            >
              {props.isCopied ? (
                <CheckIcon className="w-4 h-4 mr-2" />
              ) : (
                <CopyIcon className="w-4 h-4 mr-2" />
              )}
              <div className="flex flex-col">
                <span className="font-medium">Copy Transcript</span>
                <span className="text-xs text-muted-foreground">
                  Copy all transcript to clipboard
                </span>
              </div>
            </DropdownMenuItem>
          </div>
        </TooltipTrigger>
        {!props.allClipsHaveText && (
          <TooltipContent side="left">
            <p>Waiting for transcription to complete</p>
          </TooltipContent>
        )}
      </Tooltip>

      {props.youtubeChapters.length > 0 && (
        <DropdownMenuItem onSelect={props.copyYoutubeChaptersToClipboard}>
          {props.isChaptersCopied ? (
            <CheckIcon className="w-4 h-4 mr-2" />
          ) : (
            <CopyIcon className="w-4 h-4 mr-2" />
          )}
          <div className="flex flex-col">
            <span className="font-medium">Copy YouTube Chapters</span>
            <span className="text-xs text-muted-foreground">
              Copy chapter timestamps to clipboard
            </span>
          </div>
        </DropdownMenuItem>
      )}

      <DropdownMenuItem onSelect={props.copyLogPathToClipboard}>
        {props.isLogPathCopied ? (
          <CheckIcon className="w-4 h-4 mr-2" />
        ) : (
          <ScrollTextIcon className="w-4 h-4 mr-2" />
        )}
        <div className="flex flex-col">
          <span className="font-medium">Copy Log Path</span>
          <span className="text-xs text-muted-foreground">
            Copy operation log file path
          </span>
        </div>
      </DropdownMenuItem>
    </DropdownMenuSubContent>
  </DropdownMenuSub>
);

export const RenameVideoItem = (props: { onRenameVideoClick: () => void }) => (
  <DropdownMenuItem onSelect={props.onRenameVideoClick}>
    <PencilLineIcon className="w-4 h-4 mr-2" />
    <div className="flex flex-col">
      <span className="font-medium">Rename Video</span>
      <span className="text-xs text-muted-foreground">
        Change the video name
      </span>
    </div>
  </DropdownMenuItem>
);

export const RevealInFileSystemItem = (props: {
  onRevealInFileSystem: () => void;
}) => (
  <DropdownMenuItem onSelect={props.onRevealInFileSystem}>
    <FolderOpen className="w-4 h-4 mr-2" />
    <div className="flex flex-col">
      <span className="font-medium">Reveal in File System</span>
      <span className="text-xs text-muted-foreground">
        Open in Windows Explorer
      </span>
    </div>
  </DropdownMenuItem>
);
