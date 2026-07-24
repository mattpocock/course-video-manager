import { cn } from "@/lib/utils";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { CreateBeatDialogProvider } from "@/features/beats/create-beat-dialog";
import { BeatDndProvider } from "@/features/beats/beat-dnd-context";
import { BeatList, type BeatListBeat } from "@/features/beats/beat-list";
import type { BeatTab } from "../beat-tab";
import { ReferencePanel, type ReferenceCandidate } from "./reference-panel";
import { ScriptPanel } from "./script-panel";

/**
 * The editor's middle 40ch slot as a tabbed container holding three mutually
 * exclusive panels that share the space: **Beats** (this video's own plan),
 * **Reference** (the sibling-video reader) and **Script** (this video's
 * teleprompter script). "Reference" stays reserved for the sibling reader —
 * the beat view is the Beat Panel, never a "reference".
 *
 * The Beats tab is available iff the video has ≥1 beat, and the Reference tab
 * iff a reference video is selected; the Script tab is ALWAYS available (you
 * author the script there, empty or not), so this panel always renders. The
 * tab strip always shows so the UI stays structurally stable as tabs appear.
 */
export function EditorSidePanel(props: {
  activeTab: BeatTab;
  hasBeats: boolean;
  hasReference: boolean;
  onTabChange: (tab: BeatTab) => void;

  // Beats tab
  videoId: string;
  beats: BeatListBeat[];
  /** Read-only while a capture is in progress (recording or settling). */
  isBeatsReadOnly: boolean;
  onBeatEvent: (event: CourseEditorEvent) => void;

  // Reference tab
  referenceCandidates: ReferenceCandidate[];
  referenceVideoId: string | null;
  onRemoveReference: () => void;
  onAddReferenceChapterAt: (input: {
    videoId: string;
    targetItemId: string;
    targetItemType: "clip" | "chapter";
    position: "before" | "after";
    name: string;
  }) => void;
  onEditReferenceChapterName: (chapterId: string, name: string) => void;
  onDeleteReferenceChapter: (chapterId: string) => void;
  onGenerateReferenceChapters: () => void;
}) {
  return (
    <div className="border rounded-lg bg-muted/30 flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-1 px-1.5 py-1 border-b bg-muted/50 shrink-0">
        {props.hasBeats && (
          <TabButton
            active={props.activeTab === "beats"}
            onClick={() => props.onTabChange("beats")}
          >
            Beats
          </TabButton>
        )}
        {props.hasReference && (
          <TabButton
            active={props.activeTab === "reference"}
            onClick={() => props.onTabChange("reference")}
          >
            Reference
          </TabButton>
        )}
        <TabButton
          active={props.activeTab === "script"}
          onClick={() => props.onTabChange("script")}
        >
          Script
        </TabButton>
      </div>

      {props.activeTab === "script" ? (
        <ScriptPanel videoId={props.videoId} />
      ) : props.activeTab === "beats" ? (
        <div className="overflow-y-auto flex-1 px-3 py-2">
          <CreateBeatDialogProvider submitEvent={props.onBeatEvent}>
            <BeatDndProvider
              videos={[
                {
                  id: props.videoId,
                  beats: props.beats.map((s) => ({ id: s.id })),
                },
              ]}
              onMove={(drop) =>
                props.onBeatEvent({
                  type: "move-beat",
                  beatId: drop.beatId,
                  targetVideoId: drop.targetVideoId,
                  beforeBeatId: drop.beforeBeatId,
                })
              }
            >
              <BeatList
                video={{ id: props.videoId, beats: props.beats }}
                submitEvent={props.onBeatEvent}
                isReadOnly={props.isBeatsReadOnly}
                showDescriptions
              />
            </BeatDndProvider>
          </CreateBeatDialogProvider>
        </div>
      ) : props.referenceVideoId ? (
        <ReferencePanel
          className="flex-1 min-h-0"
          candidates={props.referenceCandidates}
          selectedId={props.referenceVideoId}
          onRemove={props.onRemoveReference}
          onAddChapterAt={props.onAddReferenceChapterAt}
          onEditChapterName={props.onEditReferenceChapterName}
          onDeleteChapter={props.onDeleteReferenceChapter}
          onGenerateChapters={props.onGenerateReferenceChapters}
        />
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2 py-1 rounded text-[11px] uppercase tracking-wider font-semibold transition-colors",
        active
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
