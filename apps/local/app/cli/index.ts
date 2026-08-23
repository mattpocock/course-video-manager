import { Command } from "@effect/cli";
import { courseCommand } from "./commands/course";
import { versionCommand } from "./commands/version";
import { sectionCommand } from "./commands/section";
import { lessonCommand } from "./commands/lesson";
import { videoCommand } from "./commands/video";
import { clipCommand } from "./commands/clip";
import { chapterCommand } from "./commands/chapter";
import { overlayCommand } from "./commands/overlay";
import { beatCommand } from "./commands/beat";
import { fileCommand } from "./commands/file";
import { footageCommand } from "./commands/footage";
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

Read-mostly: most verbs are READS. A growing set of nouns has WRITE verbs —
'beat' (add/update/move/delete), 'clip' (add/update/move/delete), 'chapter'
(add/update/move/delete), 'overlay' (add/update/delete), 'lesson'
(create/update/move), 'video'
(create/move/update), 'file' (add/delete), 'footage' (transcribe), 'pitch'
(create/update), 'deliverable' (create/update/archive) and 'course' (publish).
Every other verb is read-only, and each verb's own --help is authoritative about
whether it reads or writes.

DOMAIN MODEL
  A Course is the primary entity. Its structure is snapshotted into Course
  Versions, whose commitState is authoritative: one Draft Version (editable),
  at most one Pending Version (Submitted, mid-publish), and zero or more
  Published Versions (immutable). Version-scoped reads default to the Draft.
  A Version contains Sections (directory-backed groupings), each containing
  Lessons. A Lesson contains Videos; a Video is an ordered sequence of Clips
  (recorded timeline) and is planned as an ordered sequence of Beats
  (intended structure, by job/kind). An Overlay is a visual layer composited on
  top of the footage, anchored to a Clip at an offset in seconds and carrying a
  Definition Card (a title + description shown on screen). Pitches are course ideas with a derived
  Pitch State. Deliverables are calendar entries linking Courses and/or Pitches.

ADDRESSING (output is for agents)
  All 'get' arguments are IDs only. 'list' output is identity-rich (id, name/
  title, slug/path, parent ids) so you can map a name to an id in one call.
  Typical workflow: 'cvm <noun> list' to find an id, then 'cvm <noun> get <id>',
  or 'cvm <noun> tree <id>' then pipe to jq to drill in.

VERSIONS
  Version-scoped reads (course / section / lesson / tree) default to the Draft
  Version. Pass --course-version <id> to pin a Published Version snapshot.

PUBLISH READINESS
  'cvm course readiness <courseId>' answers "what stands between this course and
  shipping": whether it is publishable and what is blocking if not, four lists of
  outstanding work (Unexported Videos, course-view lints, invalid Lesson role
  combos, incomplete Videos), and authoring progress counts. Note Unexported
  Videos do NOT block a publish — it renders them itself — so they are reported
  as exportsRequired, apart from the blocking lists. Exportedness is read
  straight off the filesystem; the CVM server does not need to be up.

ARCHIVED
  'list' shows ACTIVE records only. Only 'course' and standalone 'video' have a
  viewable archive (use --archived to include it). For every other noun,
  archived means deleted and is never shown.

OUTPUT CONTRACT
  Raw JSON, no envelope. 'get' of one id => one JSON object. 'list' and multi-id
  'get' => NDJSON (one compact object per line). Empty list => no output, exit 0.
  Errors => a JSON object on STDERR carrying the Effect error _tag. STDOUT is
  always pure data. Exit codes: 0 ok, 2 not-found, 3 invalid-input, 4 db/internal,
  5 authentication, 6 out-of-date checkout, 7 needs the author's machine (the
  last three are explained in WHERE THE DATA LIVES and WHAT NEEDS A MACHINE).

WHERE THE DATA LIVES
  cvm does not hold a database connection. It talks to the deployed Course
  Video Manager API over HTTP, so it runs on any machine — the author's, or a
  box you were handed. Two environment variables, read from the environment or
  from the repo-root .env (found by walking up from the install location, so
  cvm works from any working directory):
    CVM_API_URL     the deployed API's base URL
    CVM_API_TOKEN   a token minted from the "API Tokens" page in the local UI
  A token is unscoped, expires (90 days by default), and can be revoked at any
  moment. Exit 5 with _tag "AuthenticationError" means the API refused it —
  unknown, expired or revoked; it deliberately never says which. That is NOT a
  "not found": do not retry it, ask for a new token.

  cvm also runs from a git checkout, and that checkout can fall behind the
  deployed API. Every request states which schema version it was built against
  and a mismatch is refused outright: exit 6, _tag
  "SchemaVersionMismatchError", naming both numbers. The fix is 'git pull' in
  this repo on this box — retrying as-is will keep failing.

WHAT NEEDS A MACHINE
  A few commands need the AUTHOR'S MACHINE rather than the data, because they
  read and write its disk:
    cvm file …              the Video Files directory
    cvm footage …           raw footage files on disk (transcribed with ffmpeg)
    cvm course readiness    the finished videos directory (exportedness)
    cvm course publish      the same, plus ffmpeg
  Anywhere else they are refused before doing any work — exit 7, _tag
  "LocalOnlyCommandError", with the reason in the message. That is a STOP, not
  a retry: no token, no pull and no repeat will make them work, and nothing is
  left half-changed. Everything else — every read, and every write verb listed
  below — works from any box with a token.

WRITES
  Write verbs hit the database immediately — no confirmation prompt, no dry-run —
  and each echoes the affected row as one pretty JSON object. Flags come BEFORE
  any positional <id> (a flag after it exits 3). The write surface:
    beat    add/update/move/delete   author a Video's Beat plan
                                     (add --pitch <id> targets a pitch's video)
    clip    add/update/move/delete   cut/retime/reorder/archive a Clip ('add'
                                     needs a footage file transcribed first)
    chapter add/update/move/delete   author a Video's Chapters (timeline
                                     dividers that group its Clips)
    overlay add/update/delete        place a Definition Card on top of the
                                     footage, anchored to a Clip at an offset
                                     in seconds ('delete' is a HARD delete —
                                     no archive, no restore)
    footage transcribe               cache a raw footage file's transcript on
                                     disk (LOCAL-ONLY; feeds 'clip add')
    lesson  create/update/move       create a lesson, rename its title,
                                     or reorder / re-home it
    video   create/move/update       create a Video, re-home it to a lesson/
                                     pitch, or rename it (--name)
    file    add/delete               attach scratch files to a Video (writer
                                     context); delete is a real unlink, and
                                     these are the only writes that do NOT
                                     need the CVM server running — but they
                                     DO need the author's machine (exit 7
                                     anywhere else, see WHAT NEEDS A MACHINE)
    pitch   create/update            create a Pitch (--title required) or patch
                                     its copy/ranking fields
    deliverable
            create/update/archive    author the Deliverables Calendar — the
                                     ONLY date-of-intent in the schema. 'update'
                                     patches any subset (--date to slip a
                                     deadline, --status to close it out);
                                     'archive' is the only hide
    course  publish                  Submit the Draft as a Pending Version,
                                     Commit it to Dropbox, Promote to Published
                                     (--name vX.Y.Z, a lowercase-'v' semver)
  See each noun's --help for the authoritative contract.

  Publish is heavier than the other writes: it also touches the filesystem
  (Dropbox) and reads publish-only config from the repo .env.

NOUNS
  course version section lesson video clip chapter overlay beat file footage
  pitch deliverable

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
    chapterCommand,
    overlayCommand,
    beatCommand,
    fileCommand,
    footageCommand,
    pitchCommand,
    deliverableCommand,
    searchCommand,
  ])
);
