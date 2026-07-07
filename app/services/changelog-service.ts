import {
  type VersionWithStructure,
  type VersionChanges,
  type VideoChange,
  detectChanges,
} from "./changelog-detection";
import { diffClips, formatDiffWithContext } from "./changelog-diff";

function formatCodePath(path: string): string {
  return `\`${path}\``;
}

function formatPathHumanReadable(path: string): string {
  return path.replace(/^\d+-/, "").replace(/-/g, " ");
}

type SectionChanges = {
  newLessons: Array<{
    lessonPath: string;
    videoTitles: string[];
    authoringStatus: "todo" | "done" | null;
  }>;
  renamedLessons: Array<{ oldPath: string; newPath: string }>;
  updatedLessons: Array<{
    lessonPath: string;
    videoChanges: VideoChange[];
  }>;
  markedReady: Array<{ lessonPath: string }>;
  markedTodo: Array<{ lessonPath: string }>;
  deletedLessons: Array<{ lessonPath: string; videoTitles: string[] }>;
  sectionRenamed?: { oldPath: string; newPath: string };
};

function organizeChangesBySection(
  changes: VersionChanges,
  currentVersion: VersionWithStructure
): Map<string, SectionChanges> {
  const sectionMap = new Map<string, SectionChanges>();

  const oldToNewSectionPath = new Map<string, string>();
  for (const section of changes.renamedSections) {
    oldToNewSectionPath.set(section.oldPath, section.newPath);
  }

  const getSection = (sectionPath: string): SectionChanges => {
    if (!sectionMap.has(sectionPath)) {
      sectionMap.set(sectionPath, {
        newLessons: [],
        renamedLessons: [],
        updatedLessons: [],
        markedReady: [],
        markedTodo: [],
        deletedLessons: [],
      });
    }
    return sectionMap.get(sectionPath)!;
  };

  for (const lesson of changes.newLessons) {
    getSection(lesson.sectionPath).newLessons.push({
      lessonPath: lesson.lessonPath,
      videoTitles: lesson.videoTitles,
      authoringStatus: lesson.authoringStatus,
    });
  }

  for (const lesson of changes.markedReady) {
    getSection(lesson.sectionPath).markedReady.push({
      lessonPath: lesson.lessonPath,
    });
  }

  for (const lesson of changes.markedTodo) {
    getSection(lesson.sectionPath).markedTodo.push({
      lessonPath: lesson.lessonPath,
    });
  }

  for (const lesson of changes.renamedLessons) {
    getSection(lesson.sectionPath).renamedLessons.push({
      oldPath: lesson.oldPath,
      newPath: lesson.newPath,
    });
  }

  for (const lesson of changes.updatedLessons) {
    getSection(lesson.sectionPath).updatedLessons.push({
      lessonPath: lesson.lessonPath,
      videoChanges: lesson.videoChanges,
    });
  }

  for (const lesson of changes.deletedLessons) {
    const effectiveSectionPath =
      oldToNewSectionPath.get(lesson.sectionPath) ?? lesson.sectionPath;
    getSection(effectiveSectionPath).deletedLessons.push({
      lessonPath: lesson.lessonPath,
      videoTitles: lesson.videoTitles,
    });
  }

  for (const section of changes.renamedSections) {
    const sectionEntry = getSection(section.newPath);
    sectionEntry.sectionRenamed = {
      oldPath: section.oldPath,
      newPath: section.newPath,
    };
  }

  const orderedSections: Array<[string, SectionChanges]> = [];
  for (const section of currentVersion.sections) {
    if (sectionMap.has(section.path)) {
      orderedSections.push([section.path, sectionMap.get(section.path)!]);
    }
  }
  for (const deleted of changes.deletedSections) {
    if (!orderedSections.some(([path]) => path === deleted.sectionPath)) {
      orderedSections.push([
        deleted.sectionPath,
        {
          newLessons: [],
          renamedLessons: [],
          updatedLessons: [],
          markedReady: [],
          markedTodo: [],
          deletedLessons: [],
        },
      ]);
    }
  }

  return new Map(orderedSections);
}

function renderVideoChanges(
  videoChanges: VideoChange[],
  lines: string[]
): void {
  for (const videoChange of videoChanges) {
    if (videoChange.type === "updated") {
      lines.push(`  - ${formatCodePath(videoChange.videoTitle)} — updated`);
      const diff = diffClips(videoChange.oldClips, videoChange.newClips);
      const diffOutput = formatDiffWithContext(diff);
      if (diffOutput.length > 0) {
        lines.push("");
        lines.push("    <details>");
        lines.push("    <summary>Transcript changes</summary>");
        lines.push("");
        lines.push("    ```diff");
        for (const diffLine of diffOutput) {
          lines.push(`    ${diffLine}`);
        }
        lines.push("    ```");
        lines.push("");
        lines.push("    </details>");
      }
    } else if (videoChange.type === "new") {
      lines.push(`  - ${formatCodePath(videoChange.videoTitle)} — new video`);
    } else if (videoChange.type === "deleted") {
      lines.push(`  - ${formatCodePath(videoChange.videoTitle)} — deleted`);
    }
  }
}

export function generateChangelog(versions: VersionWithStructure[]): string {
  // Filter out draft versions (no name) — only published versions appear in changelog
  versions = versions.filter((v) => v.name !== "");

  if (versions.length === 0) {
    return "# Changelog\n\nNo versions found.\n";
  }

  const lines: string[] = [
    "# Changelog",
    "",
    "## Glossary",
    "",
    "- **New Lessons**: Newly added content. A `(TODO)` suffix means the lesson is intentionally incomplete on the authoring side — create a course-platform stub if none exists, and look for a `TODO.md` sentinel inside the lesson's folder.",
    "- **Renamed**: The lesson or section name has changed.",
    "- **Updated**: The video has been updated and the readme needs to be rewritten.",
    "- **Marked Ready**: The lesson's authoring status flipped from TODO to done — it's now ready for the course-platform stub to be filled in.",
    "- **Marked TODO**: The lesson's authoring status flipped from done back to TODO. Existing course-platform stubs should not be touched while this state holds.",
    "- **Deleted**: The lesson or section has been removed.",
    "",
  ];

  for (let i = 0; i < versions.length; i++) {
    const currentVersion = versions[i]!;
    const previousVersion = versions[i + 1];

    lines.push(`## ${currentVersion.name}`);
    lines.push("");

    if (currentVersion.description) {
      lines.push(currentVersion.description);
      lines.push("");
    }

    if (!previousVersion) {
      lines.push("Initial version.");
      lines.push("");
      continue;
    }

    const changes = detectChanges(currentVersion, previousVersion);

    if (!changes) {
      lines.push("No changes detected.");
      lines.push("");
      continue;
    }

    const hasChanges =
      changes.newLessons.length > 0 ||
      changes.renamedSections.length > 0 ||
      changes.renamedLessons.length > 0 ||
      changes.updatedLessons.length > 0 ||
      changes.markedReady.length > 0 ||
      changes.markedTodo.length > 0 ||
      changes.deletedSections.length > 0 ||
      changes.deletedLessons.length > 0;

    if (!hasChanges) {
      lines.push("No significant changes.");
      lines.push("");
      continue;
    }

    const sectionChanges = organizeChangesBySection(changes, currentVersion);

    if (changes.deletedSections.length > 0) {
      lines.push("### Deleted Sections");
      lines.push("");
      for (const section of changes.deletedSections) {
        lines.push(`- ${formatCodePath(section.sectionPath)}`);
      }
      lines.push("");
    }

    for (const [sectionPath, sectionChange] of sectionChanges) {
      if (changes.deletedSections.some((s) => s.sectionPath === sectionPath)) {
        continue;
      }

      const hasLessonChanges =
        sectionChange.newLessons.length > 0 ||
        sectionChange.renamedLessons.length > 0 ||
        sectionChange.updatedLessons.length > 0 ||
        sectionChange.markedReady.length > 0 ||
        sectionChange.markedTodo.length > 0 ||
        sectionChange.deletedLessons.length > 0 ||
        sectionChange.sectionRenamed;

      if (!hasLessonChanges) continue;

      const displayPath = sectionChange.sectionRenamed
        ? sectionChange.sectionRenamed.newPath
        : sectionPath;
      lines.push(`### ${formatPathHumanReadable(displayPath)}`);
      lines.push("");

      if (sectionChange.sectionRenamed) {
        lines.push(
          `*Renamed from ${formatCodePath(sectionChange.sectionRenamed.oldPath)}*`
        );
        lines.push("");
      }

      if (sectionChange.newLessons.length > 0) {
        lines.push("#### New Lessons");
        lines.push("");
        for (const lesson of sectionChange.newLessons) {
          const suffix = lesson.authoringStatus === "todo" ? " (TODO)" : "";
          lines.push(`- ${formatCodePath(lesson.lessonPath)}${suffix}`);
          for (const videoTitle of lesson.videoTitles) {
            lines.push(`  - ${formatCodePath(videoTitle)}`);
          }
        }
        lines.push("");
      }

      if (sectionChange.markedReady.length > 0) {
        lines.push("#### Marked Ready");
        lines.push("");
        for (const lesson of sectionChange.markedReady) {
          lines.push(`- ${formatCodePath(lesson.lessonPath)}`);
        }
        lines.push("");
      }

      if (sectionChange.markedTodo.length > 0) {
        lines.push("#### Marked TODO");
        lines.push("");
        for (const lesson of sectionChange.markedTodo) {
          lines.push(`- ${formatCodePath(lesson.lessonPath)}`);
        }
        lines.push("");
      }

      if (sectionChange.renamedLessons.length > 0) {
        lines.push("#### Renamed");
        lines.push("");
        for (const lesson of sectionChange.renamedLessons) {
          lines.push(
            `- ${formatCodePath(lesson.oldPath)} → ${formatCodePath(lesson.newPath)}`
          );
        }
        lines.push("");
      }

      if (sectionChange.updatedLessons.length > 0) {
        lines.push("#### Updated");
        lines.push("");
        for (const lesson of sectionChange.updatedLessons) {
          lines.push(`- ${formatCodePath(lesson.lessonPath)}`);
          renderVideoChanges(lesson.videoChanges, lines);
        }
        lines.push("");
      }

      if (sectionChange.deletedLessons.length > 0) {
        lines.push("#### Deleted");
        lines.push("");
        for (const lesson of sectionChange.deletedLessons) {
          lines.push(`- ${formatCodePath(lesson.lessonPath)}`);
          for (const videoTitle of lesson.videoTitles) {
            lines.push(`  - ${formatCodePath(videoTitle)}`);
          }
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}
