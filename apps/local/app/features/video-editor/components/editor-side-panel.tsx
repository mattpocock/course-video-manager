import { cn } from "@/lib/utils";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import { CreateBeatDialogProvider } from "@/features/beats/create-beat-dialog";
import { BeatDndProvider } from "@/features/beats/beat-dnd-context";
import { BeatList, type BeatListBeat } from "@/features/beats/beat-list";
import type { BeatTab } from "../beat-tab";
import type { AnimaticLine } from "@/features/animatic/animatic-lines";
import { AnimaticPanel } from "./animatic-panel";
import { ReferencePanel, type ReferenceCandidate } from "./reference-panel";
import { ScriptPanel } from "./script-panel";

/**
 * The editor's middle 40ch slot as a tabbed container holding four mutually
 * exclusive panels that share the space: **Script** (this video's teleprompter
 * script), **Animatic** (its Clip Mockups read as lines), **Beats** (this
 * video's own plan) and **Reference** (the sibling-video reader). "Reference"
 * stays reserved for the sibling reader — the beat view is the Beat Panel,
 * never a "reference".
 *
 * The Animatic tab is available iff the video has ≥1 Clip Mockup, the Beats
 * tab iff it has ≥1 beat, and the Reference tab iff a reference video is
 * selected; the Script tab is ALWAYS available (you author the script there,
 * empty or not), so this panel always renders. The tab strip always shows so
 * the UI stays structurally stable as tabs appear.
 *
 * The Animatic tab is READ-ONLY, and must stay so. An earlier, editable
 * Mockups tab was deleted (#1724): Clip Mockups and Clip Mockup Chapters share
 * one order space, so a drag there could move a Clip Mockup into another
 * Chapter without the author seeing it. Clip Mockups are authored with `cvm
 * clip-mockup` and watched on the Animatic page.
 */
export function EditorSidePanel(props: {
  activeTab: BeatTab;
  hasBeats: boolean;
  hasReference: boolean;
  onTabChange: (tab: BeatTab) => void;

  // Animatic tab — empty when the Video has no Clip Mockups
  animatic: AnimaticLine[];

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
  onAutofillReferenceChapters: () => void;
}) {
  return (
    <div className="border rounded-lg bg-muted/30 flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-1 px-1.5 py-1 border-b bg-muted/50 shrink-0">
        {/* Script leads: it's the default tab and the one the teleprompter
            mirrors, so it gets the position the eye starts from. */}
        <TabButton
          active={props.activeTab === "script"}
          onClick={() => props.onTabChange("script")}
        >
          Script
        </TabButton>
        {props.animatic.length > 0 && (
          <TabButton
            active={props.activeTab === "animatic"}
            onClick={() => props.onTabChange("animatic")}
          >
            Animatic
          </TabButton>
        )}
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
      </div>

      {props.activeTab === "script" ? (
        <ScriptPanel videoId={props.videoId} />
      ) : props.activeTab === "animatic" ? (
        <AnimaticPanel lines={props.animatic} />
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
          onAutofillChapters={props.onAutofillReferenceChapters}
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
