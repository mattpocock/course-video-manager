import { FileTree } from "@/components/FileTree";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtTok } from "@/features/article-writer/inline-context-strip";
import {
  getPickedRepoFiles,
  getRepoFilesTokens,
  type suggestionsReducer,
} from "../suggestions-reducer";

/**
 * The Suggestions tab's **Context** modal: the Video's repo files, ticked one
 * by one in the Article Writer's `FileTree`. Every tick is a new pick, which
 * asks for a new suggestion. All state is in `suggestions-reducer.ts`.
 */
export function SuggestionsContextModal(props: {
  state: suggestionsReducer.State;
  onDismiss: () => void;
  onFilesPicked: (paths: string[]) => void;
}) {
  const { state } = props;
  const picked = getPickedRepoFiles(state);

  return (
    <Dialog
      open={state.contextModalOpen}
      onOpenChange={(open) => {
        if (!open) props.onDismiss();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Context</DialogTitle>
          <DialogDescription>
            Repo files sent with every suggestion, for this video only.{" "}
            <span className="font-mono tabular-nums">
              {picked.length} picked · ~{fmtTok(getRepoFilesTokens(picked))}{" "}
              tokens
            </span>
          </DialogDescription>
        </DialogHeader>
        {state.repoFiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This video has no repo files.
          </p>
        ) : (
          <FileTree
            files={state.repoFiles.map((file) => ({
              ...file,
              defaultEnabled: false,
            }))}
            enabledFiles={new Set(state.pickedFiles)}
            onEnabledFilesChange={(next) => props.onFilesPicked([...next])}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
