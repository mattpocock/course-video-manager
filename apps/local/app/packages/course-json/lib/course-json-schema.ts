// THE PUBLISHED CONTRACT for a course.json — the schema, and nothing else.
//
// Split out of `build-course-json.ts` so the contract can be read on its own:
// this file says what a manifest IS, that file says how one is produced.
//
// Descriptions on every field are load-bearing: `buildCourseJsonSchema` turns
// this schema into the `course.schema.json` sidecar via `JSONSchema.make`, which
// reads these annotations verbatim. Keep them in the domain's language (see
// GLOSSARY.md).

import { JSONSchema, Schema } from "effect";

const CourseJsonChapter = Schema.Struct({
  title: Schema.String.annotations({
    description:
      "The chapter name shown to viewers; maps 1:1 to a YouTube chapter.",
  }),
  startTime: Schema.Number.annotations({
    description:
      "Offset in seconds from the start of the video where this chapter begins.",
  }),
}).annotations({
  description:
    "A named marker within a video's timeline that groups related clips.",
});

const visibleFrom = Schema.Number.pipe(
  Schema.nonNegative(),
  Schema.annotations({
    description:
      "Seconds into this video at which the entry first appears on screen (accurate to about a second). There is no end: when an entry scrolls off is not recorded.",
  })
);

const entryText = (description: string) =>
  Schema.String.annotations({ description });

const UserPromptEntry = Schema.Struct({
  kind: Schema.Literal("userPrompt"),
  visibleFrom,
  text: entryText(
    "The prompt in full, as typed or dictated. A slash command is written `/<name> <args>`."
  ),
}).annotations({
  description: "A prompt sent to Claude: typed, dictated or a slash command.",
});

const AssistantTextEntry = Schema.Struct({
  kind: Schema.Literal("assistantText"),
  visibleFrom,
  text: entryText("The text block's Markdown source, in full."),
}).annotations({
  description: "One text block of Claude's reply. Thinking is never included.",
});

const InterruptEntry = Schema.Struct({
  kind: Schema.Literal("interrupt"),
  visibleFrom,
  text: entryText("Claude Code's `[Request interrupted by user…]` marker."),
}).annotations({ description: "Claude was interrupted (Escape)." });

const SkillCallEntry = Schema.Struct({
  kind: Schema.Literal("skillCall"),
  visibleFrom,
  skill: entryText("The skill's name."),
  via: Schema.Literal("toolCall", "slashCommand").annotations({
    description:
      "How the skill was loaded: Claude called the Skill tool (`toolCall`), or a slash command was typed (`slashCommand`), in which case it follows its userPrompt.",
  }),
  args: Schema.optional(
    entryText("The arguments the skill was loaded with, when there were any.")
  ),
}).annotations({
  description: "A skill was loaded. Its body is never included.",
});

const ToolCallEntry = Schema.Struct({
  kind: Schema.Literal("toolCall"),
  visibleFrom,
  tool: entryText("The tool's name, e.g. `Bash`."),
  summary: Schema.optional(
    entryText(
      "One line of the call's input (a Bash description, a file path relative to the project, a URL, a query), at most 160 characters."
    )
  ),
  resultIsError: Schema.optional(
    Schema.Boolean.annotations({
      description: "Whether the tool's result was an error, when known.",
    })
  ),
}).annotations({
  description:
    "A call to any tool but Skill, as a stub. Its input and its result are never included.",
});

export const CourseJsonSessionExtract = Schema.Struct({
  sessions: Schema.Array(
    Schema.Struct({
      sessionId: Schema.String.annotations({
        description:
          "The Agent Session's stable id, shared by every video and course version that shows it.",
      }),
      entries: Schema.Array(
        Schema.Union(
          UserPromptEntry,
          AssistantTextEntry,
          InterruptEntry,
          SkillCallEntry,
          ToolCallEntry
        ).annotations({
          description: "One Agent Session Entry, discriminated by `kind`.",
        })
      ).annotations({
        description:
          "What the session shows in this video, in visibleFrom order. Entries that never appear are left out.",
      }),
    }).annotations({
      description:
        "One Claude Code session (an Agent Session) seen in this video.",
    })
  ).annotations({
    description: "The sessions shown, in the order they first appear.",
  }),
}).annotations({
  description:
    "The Claude Code session(s) seen on screen in this video, as entries timed on the video.",
});

export const CourseJsonVideo = Schema.Struct({
  id: Schema.String.annotations({
    description:
      "Stable lineage id of the video, carried across course versions.",
  }),
  relativePath: Schema.String.annotations({
    description:
      "Path to the exported .mp4 relative to this course.json (section-dir/lesson-dir/VideoTitle.mp4).",
  }),
  body: Schema.String.annotations({
    description: "Long-form written companion to the video (its article body).",
  }),
  description: Schema.String.annotations({
    description: "Short description of the video.",
  }),
  hash: Schema.String.annotations({
    description:
      "Export Hash identifying the exported .mp4 inputs (SHA256 of the video's clip filenames and timestamps in sequence, plus the Export Version Key).",
  }),
  sha256: Schema.String.pipe(
    Schema.pattern(/^[a-f0-9]{64}$/),
    Schema.annotations({
      description:
        "Full lowercase hexadecimal SHA256 of the exported .mp4 bytes.",
    })
  ),
  bytes: Schema.Number.pipe(
    Schema.int(),
    Schema.nonNegative(),
    Schema.annotations({
      description: "Non-negative integer size of the exported .mp4 in bytes.",
    })
  ),
  chapters: Schema.Array(CourseJsonChapter).annotations({
    description: "The video's chapters, in timeline order.",
  }),
  sessionExtract: Schema.optional(
    CourseJsonSessionExtract.annotations({
      description:
        "The Claude Code session(s) on screen in this video; absent when none is.",
    })
  ),
}).annotations({
  description:
    "A single producible video output — a container of clips and chapters.",
});

const ExplainerLessonSchema = Schema.Struct({
  type: Schema.Literal("explainer").annotations({
    description:
      "Discriminant marking this lesson as a single-video explainer.",
  }),
  id: Schema.String.annotations({
    description:
      "Stable lineage id of the lesson, carried across course versions.",
  }),
  title: Schema.String.annotations({
    description: "The lesson title shown to learners.",
  }),
  explainer: CourseJsonVideo.annotations({
    description: "The explainer video that delivers this lesson.",
  }),
}).annotations({
  description:
    "A lesson delivered as a single explainer video (no problem/solution split).",
});

const ProblemLessonSchema = Schema.Struct({
  type: Schema.Literal("problem").annotations({
    description: "Discriminant marking this lesson as a problem/solution pair.",
  }),
  id: Schema.String.annotations({
    description:
      "Stable lineage id of the lesson, carried across course versions.",
  }),
  title: Schema.String.annotations({
    description: "The lesson title shown to learners.",
  }),
  problem: CourseJsonVideo.annotations({
    description: "The problem video the learner attempts.",
  }),
  solution: Schema.optional(
    CourseJsonVideo.annotations({
      description:
        "The worked-solution video; present only when the lesson ships a solution.",
    })
  ),
}).annotations({
  description:
    "A lesson delivered as a problem video with an optional worked-solution video.",
});

const PlaceholderLessonSchema = Schema.Struct({
  type: Schema.Literal("placeholder").annotations({
    description:
      "Discriminant marking this lesson as a Placeholder Lesson — announced by title alone, with no video yet.",
  }),
  id: Schema.String.annotations({
    description:
      "Stable lineage id of the lesson, carried across course versions. The same id the lesson carries when it later ships in full, so the consumer updates one resource rather than creating a second.",
  }),
  title: Schema.String.annotations({
    description: "The lesson title shown to learners.",
  }),
}).annotations({
  description:
    "A Placeholder Lesson: a lesson announced by title alone. It carries no video, no body and no description, because nobody has filmed it yet. Exactly these three keys, never a fourth.",
});

const TextLessonSchema = Schema.Struct({
  type: Schema.Literal("text").annotations({
    description:
      "Discriminant marking this lesson as a Text Lesson — a written lesson with no video.",
  }),
  id: Schema.String.annotations({
    description:
      "Stable lineage id of the lesson, carried across course versions. The same id the lesson carries if it is later filmed and ships as an explainer, so the consumer updates one resource rather than creating a second.",
  }),
  title: Schema.String.annotations({
    description: "The lesson title shown to learners.",
  }),
  body: Schema.String.annotations({
    description: "The lesson's article — for a Text Lesson, the whole lesson.",
  }),
  description: Schema.String.annotations({
    description: "Short description of the lesson.",
  }),
}).annotations({
  description:
    "A Text Lesson: a lesson whose Video has no clips and has a body, so it ships as text alone. No video entry, and no .mp4 in the Bundle.",
});

// TWO VERSIONS OF THE DOCUMENT, chosen per manifest (ADR 0059). Version 4 is
// exactly the contract every published Course already speaks, and a manifest
// that needs nothing newer is still stamped and described by it, byte for
// byte. Version 5 is a strict superset: version 4 plus the Text Lesson. A
// manifest is stamped 5 only when it holds something version 4 cannot say.

const lessonUnion = <Members extends ReadonlyArray<Schema.Schema.Any>>(
  ...members: Members
) =>
  Schema.Union(...members).annotations({
    description: "A single learning unit within a section.",
  });

const sectionOf = <Lesson extends Schema.Schema.Any>(lesson: Lesson) =>
  Schema.Struct({
    id: Schema.String.annotations({
      description:
        "Stable lineage id of the section, carried across course versions.",
    }),
    title: Schema.String.annotations({
      description: "The section title shown to learners.",
    }),
    lessons: Schema.Array(lesson).annotations({
      description:
        "The lessons this release carries in this section, in display order — the ones that ship in full and the ones announced as Placeholder Lessons.",
    }),
  }).annotations({
    description: "A grouping of lessons within the course, in display order.",
  });

const documentOf = <Version extends 4 | 5, Section extends Schema.Schema.Any>(
  version: Version,
  section: Section
) =>
  Schema.Struct({
    $schema: Schema.String.annotations({
      description:
        "Relative path to the JSON Schema describing this document (course.schema.json).",
    }),
    schemaVersion: Schema.Literal(version).annotations({
      description: "Version of the course.json manifest format.",
    }),
    courseId: Schema.String.annotations({
      description: "Stable identifier of the course this manifest snapshots.",
    }),
    courseVersionId: Schema.String.annotations({
      description:
        "Immutable Course Version identifier whose structure this manifest snapshots.",
    }),
    archiveTTL: Schema.Literal("90d").annotations({
      description:
        "Retention window for this immutable Course Version bundle, starting when the manifest is written to Dropbox. After this duration Course Builder may remove the bundle.",
    }),
    courseName: Schema.String.annotations({
      description: "Human-readable name of the course.",
    }),
    sections: Schema.Array(section).annotations({
      description: "The sections that ship in this course, in display order.",
    }),
  }).annotations({
    title: "Course Manifest",
    description:
      "The published manifest of a course — an immutable snapshot of its sections, lessons, and videos, emitted alongside the exported .mp4 files at publish time.",
  });

const CourseJsonV4LessonSchema = lessonUnion(
  ExplainerLessonSchema,
  ProblemLessonSchema,
  PlaceholderLessonSchema
);

export const CourseJsonLessonSchema = lessonUnion(
  ExplainerLessonSchema,
  ProblemLessonSchema,
  PlaceholderLessonSchema,
  TextLessonSchema
);

export const CourseJsonSectionSchema = sectionOf(CourseJsonLessonSchema);

const CourseJsonV4DocumentSchema = documentOf(
  4,
  sectionOf(CourseJsonV4LessonSchema)
);

const CourseJsonV5DocumentSchema = documentOf(5, CourseJsonSectionSchema);

/** The manifest versions the CVM writes. */
export type CourseJsonSchemaVersion = 4 | 5;

/** Either version of the manifest; `schemaVersion` says which. */
export const CourseJsonDocumentSchema = Schema.Union(
  CourseJsonV4DocumentSchema,
  CourseJsonV5DocumentSchema
);

export type CourseJsonDocument = typeof CourseJsonDocumentSchema.Type;

export type CourseJsonV4Document = typeof CourseJsonV4DocumentSchema.Type;

// The JSON Schema sidecar (`course.schema.json`) generated from the document
// schema of one version. A pure function of the version — invariant across
// courses and publishes — so callers can write it verbatim next to a
// course.json of that version. It feeds the Bundle address, which is why a
// version 4 manifest must keep getting the version 4 sidecar, unchanged.
export const buildCourseJsonSchema = (
  version: CourseJsonSchemaVersion
): JSONSchema.JsonSchema7Root =>
  version === 4
    ? JSONSchema.make(CourseJsonV4DocumentSchema)
    : JSONSchema.make(CourseJsonV5DocumentSchema);
