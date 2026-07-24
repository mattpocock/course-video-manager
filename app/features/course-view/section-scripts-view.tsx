"use client";

import { useState } from "react";
import { ScriptWriterModal } from "@/features/video-editor/script-writer-modal";
import { SectionScriptField } from "./section-script-field";

/**
 * Minimal structural shape the Scripts document needs from a section. Kept
 * loose so it accepts both the loader's Section and the optimistically-patched
 * course-view section without type friction.
 */
type SectionForScripts = {
  lessons: Array<{
    id: string;
    title: string | null;
    path: string;
    videos: Array<{ id: string; title: string }>;
  }>;
};

/**
 * The section page's **Scripts** tab: every video's teleprompter script in the
 * section stitched into one long, editable document — lesson headings with each
 * video's script as an inline {@link SectionScriptField} beneath. A top-level
 * read/write view of the whole section's script, so you can draft it end to end
 * without opening each video. Read-only on non-draft versions, matching the
 * grid's ReadOnlyBanner.
 */
export function SectionScriptsView({
  section,
  readOnly,
}: {
  section: SectionForScripts;
  readOnly: boolean;
}) {
  const [writerVideoId, setWriterVideoId] = useState<string | null>(null);

  const lessonsWithVideos = section.lessons.filter((l) => l.videos.length > 0);

  if (lessonsWithVideos.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        This section has no videos yet.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-10 pb-24">
      {lessonsWithVideos.map((lesson) => (
        <section key={lesson.id} className="space-y-5">
          <h2 className="text-lg font-bold border-b border-border pb-1">
            {lesson.title || lesson.path}
          </h2>
          {lesson.videos.map((video) => (
            <SectionScriptField
              key={video.id}
              videoId={video.id}
              title={video.title}
              readOnly={readOnly}
              onOpenWriter={() => setWriterVideoId(video.id)}
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
