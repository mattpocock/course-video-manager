/**
 * The two panels that can't render until the filesystem scan resolves.
 *
 * They're split out from `video-player-panel.tsx` purely so each one can `use()`
 * the promise at its own boundary: suspending here keeps the player itself
 * rendering while the scan is still in flight.
 */
import { use } from "react";
import { AddVideoModal } from "@/components/add-video-modal";
import {
  SuggestionsPanel,
  type SuggestionsPanelProps,
} from "./suggestions-panel";

export type FsData = Promise<{
  hasExplainerFolder: boolean;
  standaloneFiles: Array<{ path: string }>;
  files: Array<{ path: string; size: number; defaultEnabled: boolean }>;
}>;

export const DeferredSuggestionsPanel = (
  props: Omit<SuggestionsPanelProps, "files"> & { fsData: FsData }
) => {
  const { fsData: fsDataPromise, ...rest } = props;
  const fsData = use(fsDataPromise);
  return <SuggestionsPanel {...rest} files={fsData.files} />;
};

export const DeferredAddVideoModal = (props: {
  fsData: FsData;
  lessonId?: string;
  videoCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { fsData: fsDataPromise, ...rest } = props;
  const fsData = use(fsDataPromise);
  return (
    <AddVideoModal {...rest} hasExplainerFolder={fsData.hasExplainerFolder} />
  );
};
