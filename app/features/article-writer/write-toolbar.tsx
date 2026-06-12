import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  CopyIcon,
  SaveIcon,
  CheckIcon,
  PlusIcon,
  FileTextIcon,
  AlertTriangleIcon,
  RadioIcon,
  FileTypeIcon,
  SettingsIcon,
  Trash2Icon,
  RefreshCwIcon,
} from "lucide-react";
import type { LintViolation } from "./lint-rules";
import type { Mode, Model } from "./types";
import { WriteModeDropdown } from "./write-mode-dropdown";

export type SaveTargetFolder = "explainer" | "problem" | "solution";

export interface WriteToolbarProps {
  mode: Mode;
  model: Model;
  status: "streaming" | "submitted" | "ready" | "error";
  isCopied: boolean;
  messagesLength: number;
  violations: LintViolation[];
  availableFolders: readonly SaveTargetFolder[];
  foldersWithReadme: Set<string>;
  isStandalone: boolean;
  isDocumentMode: boolean;
  lastAssistantMessageText: string;
  writeToReadmeFetcherState: "idle" | "submitting" | "loading";
  hasUnresolvedScreenshots: boolean;
  onModeChange: (mode: Mode) => void;
  onModelChange: (model: Model) => void;
  onCopyToClipboard: () => void;
  onCopyAsRichText: () => void;
  onCopyConversationHistory: () => void;
  onGoLive: () => void;
  onFixLintViolations: () => void;
  onOpenBannedPhrases: () => void;
  onRegenerate: () => void;
  onClearChat: () => void;
  onWriteToReadme: (
    mode: "write" | "append",
    targetFolder: SaveTargetFolder
  ) => void;
}

export function WriteToolbar(props: WriteToolbarProps) {
  const {
    mode,
    model,
    status,
    isCopied,
    messagesLength,
    violations,
    availableFolders,
    foldersWithReadme,
    isStandalone,
    isDocumentMode,
    lastAssistantMessageText,
    writeToReadmeFetcherState,
    onModeChange,
    onModelChange,
    onCopyToClipboard,
    onCopyAsRichText,
    onCopyConversationHistory,
    onGoLive,
    onFixLintViolations,
    onOpenBannedPhrases,
    onRegenerate,
    onClearChat,
    onWriteToReadme,
    hasUnresolvedScreenshots,
  } = props;

  return (
    <div className="mb-4 flex gap-2 items-center">
      <WriteModeDropdown mode={mode} onModeChange={onModeChange} />
      <ModelSelector model={model} onModelChange={onModelChange} />
      {!isDocumentMode && (
        <CopyButtons
          mode={mode}
          status={status}
          isCopied={isCopied}
          messagesLength={messagesLength}
          lastAssistantMessageText={lastAssistantMessageText}
          hasUnresolvedScreenshots={hasUnresolvedScreenshots}
          onCopyToClipboard={onCopyToClipboard}
          onCopyAsRichText={onCopyAsRichText}
          onCopyConversationHistory={onCopyConversationHistory}
        />
      )}
      {mode === "interview-prep" && messagesLength > 0 && (
        <Button
          variant="default"
          size="sm"
          onClick={onGoLive}
          disabled={status === "streaming"}
        >
          <RadioIcon className="h-4 w-4 mr-1" />
          Go Live
        </Button>
      )}
      {!isDocumentMode && violations.length > 0 && (
        <LintFixButton
          violations={violations}
          onFixLintViolations={onFixLintViolations}
        />
      )}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onOpenBannedPhrases}
            >
              <SettingsIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Manage banned phrases</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {messagesLength > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onRegenerate}
                disabled={status === "streaming" || status === "submitted"}
              >
                <RefreshCwIcon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Regenerate last response</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {messagesLength > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onClearChat}
                disabled={status === "streaming"}
              >
                <Trash2Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Clear chat</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {!isStandalone && !isDocumentMode && (
        <ReadmeDropdown
          availableFolders={availableFolders}
          foldersWithReadme={foldersWithReadme}
          status={status}
          writeToReadmeFetcherState={writeToReadmeFetcherState}
          lastAssistantMessageText={lastAssistantMessageText}
          hasUnresolvedScreenshots={hasUnresolvedScreenshots}
          onWriteToReadme={onWriteToReadme}
        />
      )}
    </div>
  );
}

function ModelSelector(props: {
  model: Model;
  onModelChange: (model: Model) => void;
}) {
  const { model, onModelChange } = props;
  return (
    <Select
      value={model}
      onValueChange={(value) => onModelChange(value as Model)}
    >
      <SelectTrigger>
        {model === "auto"
          ? "Auto"
          : model === "claude-sonnet-4-5"
            ? "Sonnet 4.5"
            : "Haiku 4.5"}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">
          <div>
            <div>Auto</div>
            <div className="text-xs text-muted-foreground">
              Haiku for generation, Sonnet for editing
            </div>
          </div>
        </SelectItem>
        <SelectItem value="claude-haiku-4-5">
          <div>
            <div>Haiku 4.5</div>
            <div className="text-xs text-muted-foreground">
              Fast and cost-effective
            </div>
          </div>
        </SelectItem>
        <SelectItem value="claude-sonnet-4-5">
          <div>
            <div>Sonnet 4.5</div>
            <div className="text-xs text-muted-foreground">
              More capable and thorough
            </div>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

function CopyButtons(props: {
  mode: Mode;
  status: string;
  isCopied: boolean;
  messagesLength: number;
  lastAssistantMessageText: string;
  hasUnresolvedScreenshots: boolean;
  onCopyToClipboard: () => void;
  onCopyAsRichText: () => void;
  onCopyConversationHistory: () => void;
}) {
  const {
    mode,
    status,
    isCopied,
    messagesLength,
    lastAssistantMessageText,
    hasUnresolvedScreenshots,
    onCopyToClipboard,
    onCopyAsRichText,
    onCopyConversationHistory,
  } = props;

  const isConversationMode =
    mode === "interview-prep" ||
    mode === "interview" ||
    mode === "brainstorming" ||
    mode === "scoping-discussion";

  if (isConversationMode) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={status === "streaming" || messagesLength === 0}
          >
            {isCopied ? (
              <>
                <CheckIcon className="h-4 w-4 mr-1" />
                Copied
              </>
            ) : (
              <>
                <CopyIcon className="h-4 w-4 mr-1" />
                Copy
                <ChevronDown className="h-3 w-3 ml-1" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onCopyConversationHistory}>
            Copy Conversation History
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onCopyToClipboard}
            disabled={!lastAssistantMessageText}
          >
            Copy Last Message
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={
            status === "streaming" ||
            !lastAssistantMessageText ||
            hasUnresolvedScreenshots
          }
        >
          {isCopied ? (
            <>
              <CheckIcon className="h-4 w-4 mr-1" />
              Copied
            </>
          ) : (
            <>
              <CopyIcon className="h-4 w-4 mr-1" />
              Copy
              <ChevronDown className="h-3 w-3 ml-1" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={onCopyToClipboard}>
          <FileTextIcon className="h-4 w-4 mr-2" />
          Copy as Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCopyAsRichText}>
          <FileTypeIcon className="h-4 w-4 mr-2" />
          Copy as Rich Text
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LintFixButton(props: {
  violations: LintViolation[];
  onFixLintViolations: () => void;
}) {
  const { violations, onFixLintViolations } = props;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" onClick={onFixLintViolations}>
            <AlertTriangleIcon className="h-4 w-4 mr-1 text-orange-500" />
            Fix ({violations.reduce((sum, v) => sum + v.count, 0)})
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1">
            <p className="font-semibold">Lint Violations:</p>
            {violations.map((v) => (
              <p key={v.rule.id} className="text-sm">
                • {v.rule.name}: {v.count} issue
                {v.count > 1 ? "s" : ""}
              </p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ReadmeDropdown(props: {
  availableFolders: readonly SaveTargetFolder[];
  foldersWithReadme: Set<string>;
  status: string;
  writeToReadmeFetcherState: "idle" | "submitting" | "loading";
  lastAssistantMessageText: string;
  hasUnresolvedScreenshots: boolean;
  onWriteToReadme: (
    mode: "write" | "append",
    targetFolder: SaveTargetFolder
  ) => void;
}) {
  const {
    availableFolders,
    foldersWithReadme,
    status,
    writeToReadmeFetcherState,
    lastAssistantMessageText,
    hasUnresolvedScreenshots,
    onWriteToReadme,
  } = props;

  return (
    <DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    status === "streaming" ||
                    writeToReadmeFetcherState === "submitting" ||
                    writeToReadmeFetcherState === "loading" ||
                    !lastAssistantMessageText ||
                    hasUnresolvedScreenshots
                  }
                >
                  {writeToReadmeFetcherState === "submitting" ||
                  writeToReadmeFetcherState === "loading" ? (
                    <>
                      <SaveIcon className="h-4 w-4 mr-1" />
                      Writing...
                    </>
                  ) : (
                    <>
                      <SaveIcon className="h-4 w-4 mr-1" />
                      Readme
                      <ChevronDown className="h-4 w-4 ml-1" />
                    </>
                  )}
                </Button>
              </DropdownMenuTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Save to README</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end">
        {availableFolders.map((folder, index) => (
          <div key={folder}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => onWriteToReadme("write", folder)}>
              <SaveIcon className="h-4 w-4 mr-2" />
              <div className="flex flex-col">
                <span className="font-medium">Write to {folder}/readme.md</span>
                <span className="text-xs text-muted-foreground">
                  Replace existing content
                </span>
              </div>
            </DropdownMenuItem>
            {foldersWithReadme.has(folder) && (
              <DropdownMenuItem
                onSelect={() => onWriteToReadme("append", folder)}
              >
                <PlusIcon className="h-4 w-4 mr-2" />
                <div className="flex flex-col">
                  <span className="font-medium">
                    Append to {folder}/readme.md
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Add to end of existing content
                  </span>
                </div>
              </DropdownMenuItem>
            )}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
