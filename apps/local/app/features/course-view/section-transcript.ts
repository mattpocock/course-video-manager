import type { Lesson, Section, Video } from "./course-view-types";
import { filterLessons } from "./section-grid-utils";

export type TranscriptFormat = "xml" | "markdown" | "json";

export type TranscriptOptions = {
  includeTranscripts: boolean;
  includeLessonDescriptions: boolean;
  includeLessonTitles: boolean;
  includePriority: boolean;
  includeExerciseType: boolean;
  includeSectionDescription: boolean;
  includeBeats: boolean;
};

const defaultOptions: TranscriptOptions = {
  includeTranscripts: false,
  includeLessonDescriptions: true,
  includeLessonTitles: true,
  includePriority: false,
  includeExerciseType: false,
  includeSectionDescription: false,
  includeBeats: false,
};

export function buildCourseTranscript(
  coursePath: string,
  sections: Section[],
  options: TranscriptOptions = defaultOptions,
  videoTranscripts: Record<string, string> = {},
  format: TranscriptFormat = "xml"
): string {
  if (format === "markdown") {
    return buildCourseTranscriptMarkdown(
      coursePath,
      sections,
      options,
      videoTranscripts
    );
  }
  if (format === "json") {
    return buildCourseTranscriptJson(
      coursePath,
      sections,
      options,
      videoTranscripts
    );
  }
  return buildCourseTranscriptXml(
    coursePath,
    sections,
    options,
    videoTranscripts
  );
}

export function buildSectionTranscript(
  sectionPath: string,
  lessons: Lesson[],
  options: TranscriptOptions = defaultOptions,
  videoTranscripts: Record<string, string> = {},
  sectionDescription?: string,
  format: TranscriptFormat = "xml"
): string {
  if (format === "markdown") {
    return buildSectionTranscriptMarkdown(
      sectionPath,
      lessons,
      options,
      videoTranscripts,
      sectionDescription
    );
  }
  if (format === "json") {
    return buildSectionTranscriptJson(
      sectionPath,
      lessons,
      options,
      videoTranscripts,
      sectionDescription
    );
  }
  return buildSectionTranscriptXml(
    sectionPath,
    lessons,
    options,
    videoTranscripts,
    sectionDescription
  );
}

// --- XML format ---

function buildCourseTranscriptXml(
  coursePath: string,
  sections: Section[],
  options: TranscriptOptions,
  videoTranscripts: Record<string, string>
) {
  const lines: string[] = [`<course title="${escapeAttr(coursePath)}">`];
  for (const section of sections) {
    const sectionLines = buildSectionTranscriptXml(
      section.path,
      section.lessons,
      options,
      videoTranscripts,
      section.description ?? undefined
    );
    for (const line of sectionLines.split("\n")) {
      lines.push(`  ${line}`);
    }
  }
  lines.push("</course>");
  return lines.join("\n");
}

function buildSectionTranscriptXml(
  sectionPath: string,
  lessons: Lesson[],
  options: TranscriptOptions,
  videoTranscripts: Record<string, string>,
  sectionDescription?: string
) {
  const lines: string[] = [`<section title="${escapeAttr(sectionPath)}">`];
  if (options.includeSectionDescription && sectionDescription) {
    lines.push(
      `  <description>${escapeAttr(sectionDescription)}</description>`
    );
  }
  for (const lesson of lessons) {
    const lessonAttrs = [
      `title="${escapeAttr(lesson.path)}"`,
      ...(options.includeLessonTitles && lesson.title
        ? [`name="${escapeAttr(lesson.title)}"`]
        : []),
      ...(options.includePriority
        ? [`priority="p${lesson.priority ?? 2}"`]
        : []),
      ...(options.includeExerciseType && lesson.icon
        ? [`type="${escapeAttr(lesson.icon)}"`]
        : []),
    ].join(" ");
    lines.push(`  <lesson ${lessonAttrs}>`);
    if (options.includeLessonDescriptions && lesson.description) {
      lines.push(
        `    <description>${escapeAttr(lesson.description)}</description>`
      );
    }
    if (lesson.videos.length === 0) {
      lines.push("    (no videos)");
      lines.push("  </lesson>");
      continue;
    }
    for (const video of lesson.videos) {
      lines.push(`    <video title="${escapeAttr(video.title)}">`);
      if (options.includeBeats) {
        renderBeatsXml(video, lines, "      ");
      }
      if (options.includeTranscripts) {
        if (video.clipCount === 0) {
          lines.push("      (no clips)");
          lines.push("    </video>");
          continue;
        }
        const transcript = videoTranscripts[video.id];
        lines.push(`      ${transcript || "(no transcript)"}`);
      }
      lines.push("    </video>");
    }
    lines.push("  </lesson>");
  }
  lines.push("</section>");
  return lines.join("\n");
}

function renderBeatsXml(video: Video, lines: string[], indent: string) {
  for (const beat of video.beats) {
    const attrs = `kind="${escapeAttr(beat.kind)}" title="${escapeAttr(beat.title)}"`;
    if (beat.description) {
      lines.push(`${indent}<beat ${attrs}>`);
      lines.push(
        `${indent}  <description>${escapeAttr(beat.description)}</description>`
      );
      lines.push(`${indent}</beat>`);
    } else {
      lines.push(`${indent}<beat ${attrs} />`);
    }
  }
}

function renderBeatsMarkdown(video: Video, lines: string[]) {
  for (const beat of video.beats) {
    lines.push(`- [${beat.kind}] ${beat.title}`);
    if (beat.description) {
      lines.push(`  ${beat.description}`);
    }
  }
}

// --- Markdown format ---

function buildCourseTranscriptMarkdown(
  coursePath: string,
  sections: Section[],
  options: TranscriptOptions,
  videoTranscripts: Record<string, string>
) {
  const parts: string[] = [`# ${coursePath}`];
  for (const section of sections) {
    parts.push("");
    const sectionMd = buildSectionTranscriptMarkdownInner(
      section.path,
      section.lessons,
      options,
      videoTranscripts,
      section.description ?? undefined,
      2
    );
    parts.push(sectionMd);
  }
  return parts.join("\n");
}

function buildSectionTranscriptMarkdown(
  sectionPath: string,
  lessons: Lesson[],
  options: TranscriptOptions,
  videoTranscripts: Record<string, string>,
  sectionDescription?: string
) {
  return buildSectionTranscriptMarkdownInner(
    sectionPath,
    lessons,
    options,
    videoTranscripts,
    sectionDescription,
    1
  );
}

function buildSectionTranscriptMarkdownInner(
  sectionPath: string,
  lessons: Lesson[],
  options: TranscriptOptions,
  videoTranscripts: Record<string, string>,
  sectionDescription: string | undefined,
  headingLevel: number
) {
  const h = "#".repeat(headingLevel);
  const lessonH = "#".repeat(headingLevel + 1);
  const lines: string[] = [`${h} ${sectionPath}`];

  if (options.includeSectionDescription && sectionDescription) {
    lines.push("");
    lines.push(`> ${sectionDescription}`);
  }

  for (const lesson of lessons) {
    const titleParts: string[] = [lesson.path];
    if (options.includeLessonTitles && lesson.title) {
      titleParts.push(`(${lesson.title})`);
    }
    if (options.includePriority) {
      titleParts.push(`[P${lesson.priority ?? 2}]`);
    }
    if (options.includeExerciseType && lesson.icon) {
      titleParts.push(`[${lesson.icon}]`);
    }

    lines.push("");
    lines.push(`${lessonH} ${titleParts.join(" ")}`);

    if (options.includeLessonDescriptions && lesson.description) {
      lines.push("");
      lines.push(`> ${lesson.description}`);
    }

    if (lesson.videos.length === 0) {
      lines.push("");
      lines.push("(no videos)");
      continue;
    }

    for (const video of lesson.videos) {
      lines.push("");
      lines.push(`**${video.title}:**`);
      if (options.includeBeats) {
        renderBeatsMarkdown(video, lines);
      }
      if (options.includeTranscripts) {
        if (video.clipCount === 0) {
          lines.push("(no clips)");
          continue;
        }
        const transcript = videoTranscripts[video.id];
        lines.push(transcript || "(no transcript)");
      }
    }
  }

  return lines.join("\n");
}

// --- JSON format ---

function buildCourseTranscriptJson(
  coursePath: string,
  sections: Section[],
  options: TranscriptOptions,
  videoTranscripts: Record<string, string>
) {
  const obj: Record<string, unknown> = {
    course: coursePath,
    sections: sections.map((section) =>
      buildSectionObject(
        section.path,
        section.lessons,
        options,
        videoTranscripts,
        section.description ?? undefined
      )
    ),
  };
  return JSON.stringify(obj, null, 2);
}

function buildSectionTranscriptJson(
  sectionPath: string,
  lessons: Lesson[],
  options: TranscriptOptions,
  videoTranscripts: Record<string, string>,
  sectionDescription?: string
) {
  const obj = buildSectionObject(
    sectionPath,
    lessons,
    options,
    videoTranscripts,
    sectionDescription
  );
  return JSON.stringify(obj, null, 2);
}

function buildSectionObject(
  sectionPath: string,
  lessons: Lesson[],
  options: TranscriptOptions,
  videoTranscripts: Record<string, string>,
  sectionDescription?: string
) {
  const obj: Record<string, unknown> = { section: sectionPath };

  if (options.includeSectionDescription && sectionDescription) {
    obj.description = sectionDescription;
  }

  obj.lessons = lessons.map((lesson) => {
    const lessonObj: Record<string, unknown> = { title: lesson.path };

    if (options.includeLessonTitles && lesson.title) {
      lessonObj.name = lesson.title;
    }
    if (options.includePriority) {
      lessonObj.priority = `p${lesson.priority ?? 2}`;
    }
    if (options.includeExerciseType && lesson.icon) {
      lessonObj.type = lesson.icon;
    }
    if (options.includeLessonDescriptions && lesson.description) {
      lessonObj.description = lesson.description;
    }

    lessonObj.videos = lesson.videos.map((video) => {
      const videoObj: Record<string, unknown> = { title: video.title };
      if (options.includeBeats) {
        videoObj.beats = video.beats.map((beat) => {
          const beatObj: Record<string, unknown> = {
            kind: beat.kind,
            title: beat.title,
          };
          if (beat.description) {
            beatObj.description = beat.description;
          }
          return beatObj;
        });
      }
      if (options.includeTranscripts) {
        if (video.clipCount === 0) {
          videoObj.transcript = null;
        } else {
          const transcript = videoTranscripts[video.id];
          videoObj.transcript = transcript || null;
        }
      }
      return videoObj;
    });

    return lessonObj;
  });

  return obj;
}

// --- Filtering ---

export type TranscriptFilterOptions = {
  priorityFilter: number[];
  iconFilter: string[];
  todoFilter: boolean;
  searchQuery: string;
};

export function filterSectionsForTranscript(
  sections: Section[],
  filters: TranscriptFilterOptions
): Section[] {
  return sections
    .map((section) => {
      const { filteredLessons } = filterLessons(section.lessons, filters);
      return { ...section, lessons: filteredLessons } as Section;
    })
    .filter((section) => section.lessons.length > 0);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
