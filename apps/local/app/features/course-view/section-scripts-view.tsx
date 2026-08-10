"use client";

import { useState } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { ScriptWriterModal } from "@/features/video-editor/script-writer-modal";
import { Button } from "@/components/ui/button";
import { SectionScriptField } from "./section-script-field";
import {
  buildSectionScripts,
  scriptVideoIds,
  type SectionForScripts,
} from "./section-scripts-utils";
import { useCollapsedIds } from "./use-collapsed-ids";

const COLLAPSED_SCRIPTS_KEY = "collapsed-scripts";

/**
 * The section page's **Scripts** tab: every video's teleprompter script in the
 * section stitched into one long, editable document — lesson headings with each
 * video's script as an inline {@link SectionScriptField} beneath. A top-level
 * read/write view of the whole section's script, so you can draft it end to end
 * without opening each video.
 *
 * Reads are seeded from the section loader (which re-attaches `script` for this
 * one section — see the route loader) via the pure {@link buildSectionScripts}
 * view model; writes still go per-video through `/api/videos/:videoId/script`.
 * Read-only on non-draft versions, matching the grid's ReadOnlyBanner.
 *
 * Long sections read as a wall of prose, so each script folds to a one-line
 * preview (and the header folds them all at once). Which ones are folded is
 * remembered per browser by video id — see {@link useCollapsedIds}.
 */
export function SectionScriptsView({
  section,
  readOnly,
}: {
  section: SectionForScripts;
  readOnly: boolean;
}) {
  const [writerVideoId, setWriterVideoId] = useState<string | null>(null);
  const { collapsed, toggle, areAllCollapsed, toggleAll } = useCollapsedIds(
    COLLAPSED_SCRIPTS_KEY
  );

  const lessons = buildSectionScripts(section);

  if (lessons.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        This section has no videos yet.
      </div>
    );
  }

  const videoIds = scriptVideoIds(lessons);
  const allCollapsed = areAllCollapsed(videoIds);

  return (
    <div className="max-w-3xl mx-auto space-y-10 pb-24">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          onClick={() => toggleAll(videoIds)}
        >
          {allCollapsed ? (
            <ChevronsUpDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronsDownUp className="w-3.5 h-3.5" />
          )}
          {allCollapsed ? "Expand all" : "Collapse all"}
        </Button>
      </div>

      {lessons.map((lesson) => (
        <section key={lesson.lessonId} className="space-y-5">
          <h2 className="text-lg font-bold border-b border-border pb-1">
            {lesson.heading}
          </h2>
          {lesson.videos.map((video) => (
            <SectionScriptField
              key={video.videoId}
              videoId={video.videoId}
              title={video.title}
              initialScript={video.script}
              readOnly={readOnly}
              collapsed={collapsed.has(video.videoId)}
              onToggleCollapsed={() => toggle(video.videoId)}
              onOpenWriter={() => setWriterVideoId(video.videoId)}
            />
          ))}
        </section>
      ))}

      {writerVideoId && (
        <ScriptWriterModal
          videoId={writerVideoId}
          open={writerVideoId !== null}
          onOpenChange={(open) => {
            if (!open) setWriterVideoId(null);
          }}
        />
      )}
    </div>
  );
}
