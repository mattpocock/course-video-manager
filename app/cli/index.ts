import { Command } from "@effect/cli";
import { courseCommand } from "./commands/course";
import { versionCommand } from "./commands/version";
import { sectionCommand } from "./commands/section";
import { lessonCommand } from "./commands/lesson";
import { videoCommand } from "./commands/video";
import { clipCommand } from "./commands/clip";
import { segmentCommand } from "./commands/segment";
import { pitchCommand } from "./commands/pitch";
import { deliverableCommand } from "./commands/deliverable";
import { searchCommand } from "./commands/search";

/**
 * Top-level `cvm --help` text. This is a DOMAIN-TEACHING document — keep it in
 * sync with CONTEXT.md by hand (see the pointer added to CLAUDE.md). It teaches
 * the domain model, addressing, and version conventions; each noun/verb adds
 * its own ubiquitous-language help.
 */
const ROOT_HELP = `cvm — agent-facing access to this Course Video Manager project's domain data.

Read-mostly: every noun is READ-ONLY except 'segment', which is the first
write-capable noun (segment add/update/move/delete author a Video's Segment
plan). More nouns may gain writes over time; each verb's own --help is
authoritative about whether it reads or writes.

DOMAIN MODEL
  A Course is the primary entity. Its structure is snapshotted into Course
  Versions: a Draft Version (latest, editable) and zero or more Published
  Versions (frozen at Publish). Version-scoped reads default to the Draft.
  A Version contains Sections (directory-backed groupings), each containing
  Lessons. A Lesson contains Videos; a Video is an ordered sequence of Clips
  (recorded timeline) and is planned as an ordered sequence of Segments
  (intended structure, by job/kind). Pitches are course ideas with a derived
  Pitch State. Deliverables are calendar entries linking Courses and/or Pitches.

ADDRESSING (output is for agents)
  All 'get' arguments are IDs only. 'list' output is identity-rich (id, name/
  title, slug/path, parent ids) so you can map a name to an id in one call.
  Typical workflow: 'cvm <noun> list' to find an id, then 'cvm <noun> get <id>',
  or 'cvm <noun> tree <id>' then pipe to jq to drill in.

VERSIONS
  Version-scoped reads (course / section / lesson / tree) default to the Draft
  Version. Pass --course-version <id> to pin a Published Version snapshot.

ARCHIVED
  'list' shows ACTIVE records only. Only 'course' and standalone 'video' have a
  viewable archive (use --archived to include it). For every other noun,
  archived means deleted and is never shown.

OUTPUT CONTRACT
  Raw JSON, no envelope. 'get' of one id => one JSON object. 'list' and multi-id
  'get' => NDJSON (one compact object per line). Empty list => no output, exit 0.
  Errors => a JSON object on STDERR carrying the Effect error _tag. STDOUT is
  always pure data. Exit codes: 0 ok, 2 not-found, 3 invalid-input, 4 db/internal.

WRITES ('segment' only)
  'segment add/update/move/delete' author a Video's Segment plan. Writes hit the
  database immediately — no confirmation prompt, no dry-run. Each write echoes
  the affected row (delete echoes the archived row). Flags come BEFORE the
  positional <id> (a flag after it exits 3). See 'cvm segment --help'.

NOUNS
  course version section lesson video clip segment pitch deliverable

SEARCH
  search <query>   Case-insensitive substring search DOWN THE TREE across every
                   active course's Draft Version + all pitches (--type to narrow
                   result kinds). Scoped variants: 'cvm course|section|lesson
                   search <id> <query>' confine the walk to that subtree.`;

/**
 * The root `cvm` command. Each noun command lives at app/cli/commands/<noun>.ts
 * and is registered here. This file references ALL nouns up front so the noun
 * commands can be implemented in parallel WITHOUT editing this file.
 */
export const rootCommand = Command.make("cvm").pipe(
  Command.withDescription(ROOT_HELP),
  Command.withSubcommands([
    courseCommand,
    versionCommand,
    sectionCommand,
    lessonCommand,
    videoCommand,
    clipCommand,
    segmentCommand,
    pitchCommand,
    deliverableCommand,
    searchCommand,
  ])
);
