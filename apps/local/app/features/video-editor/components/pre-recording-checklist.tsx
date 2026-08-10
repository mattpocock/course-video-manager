import {
  CircleQuestionMarkIcon,
  MonitorIcon,
  Columns2,
  UserRound,
} from "lucide-react";

/**
 * Pre-recording checklist component shown when no clips exist yet.
 * Displays a checklist of items to verify before recording.
 */
export const PreRecordingChecklist = () => {
  return (
    <div className="bg-card rounded-lg p-6">
      <h2 className="text-xl font-bold text-card-foreground mb-4 flex items-center gap-2">
        <CircleQuestionMarkIcon className="size-6" />
        Pre-recording checklist
      </h2>
      <ol className="space-y-3 text-base">
        <li className="flex items-center gap-3">
          <MonitorIcon className="size-5 flex-shrink-0 text-muted-foreground" />
          <span>Close the windows</span>
        </li>
        <li className="flex items-center gap-3">
          <Columns2 className="size-5 flex-shrink-0 text-muted-foreground" />
          <span>Close the blinds</span>
        </li>
        <li className="flex items-center gap-3">
          <UserRound className="size-5 flex-shrink-0 text-muted-foreground" />
          <span>Check bookshelf books are standing up properly</span>
        </li>
      </ol>
    </div>
  );
};
