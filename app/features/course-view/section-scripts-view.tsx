"use client";

import { useState } from "react";
import { ScriptWriterModal } from "@/features/video-editor/script-writer-modal";
import { SectionScriptField } from "./section-script-field";
import {
  buildSectionScripts,
  type SectionForScripts,
} from "./section-scripts-utils";

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
 */
export function SectionScriptsView({
  section,
  readOnly,
}: {
  section: SectionForScripts;
  readOnly: boolean;
}) {
  const [writerVideoId, setWriterVideoId] = useState<string | null>(null);

  const lessons = buildSectionScripts(section);

  if (lessons.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        This section has no videos yet.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-10 pb-24">
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
