import { PlusIcon } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { SessionPanel } from "./recording-session-panel";
import { INSERTION_POINT_ID, RECORDING_SESSION_PANELS_ID } from "../constants";

/**
 * Unified component that merges the insertion point indicator with recording
 * session panels. When no sessions are active, displays just the dashed blue
 * insertion line. When recording starts, the line expands into a container
 * that reveals the session panels with a smooth height animation.
 */
export const InsertionPointWithSession = () => {
  const sessionPanels = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.sessionPanels
  );

  const hasSessions = sessionPanels.length > 0;

  return (
    <div id={INSERTION_POINT_ID}>
      {/* Insertion point line */}
      <div className="flex items-center justify-center gap-4">
        <div className="border-t-2 w-full border-blue-400 dark:border-blue-200 border-dashed flex-1" />
        <div className="flex items-center justify-center">
          <PlusIcon className="size-5 text-blue-400 dark:text-blue-200" />
        </div>
        <div className="border-t-2 w-full border-blue-400 dark:border-blue-200 border-dashed flex-1" />
      </div>

      {/* Session panels with animated height reveal */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: hasSessions ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div id={RECORDING_SESSION_PANELS_ID} className="space-y-3 pt-3">
            {sessionPanels.map((panel) => (
              <SessionPanel key={panel.sessionId} panel={panel} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
