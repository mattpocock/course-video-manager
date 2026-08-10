/**
 * Long-form --help text for the `cvm file` verbs, split out of file.ts to keep
 * that command module under the repo's per-file token budget. These are
 * domain-teaching prose strings consumed only by Command.withDescription.
 */
export const HELP = `File — the scratch files attached to a single Video.

A File is a plain file on disk living under a Video's own directory. Files are
NOT rows in the database: the directory listing IS the state, so adding a file
is the whole operation. They belong to a VIDEO (never to a Lesson directly) —
lesson-bound and standalone Videos behave identically here.

What they are FOR: extra context for the Article Writer. When you write an
article, CVM feeds the writer the Video's derived Transcript, its Beats, and
the text Files attached to it. So a File is how you hand the writer material
that was never spoken on camera — a code sample, a snippet dug out of a chat
log, research notes, a spec.

The usual preparation loop:
  cvm video transcript <videoId>        # read what was actually said
  ...gather/author supporting material into local files...
  cvm file add --video <videoId> notes.md snippet.ts
  ...then open the writer, where those files are selectable context.

Files whose extension is one of ts/tsx/js/jsx/json/md/mdx/txt/csv are TICKED BY
DEFAULT in the writer's context picker (reported as defaultEnabled). Anything
else is attached but starts unticked. Images are attached and passed to the
writer as images.

Subdirectories are supported: paths are relative to the Video's directory and
POSIX-separated ("notes/snippet.md"). Dotfiles and node_modules are ignored by
the listing and never reach the writer.

file is one of cvm's write-capable nouns: add and delete both hit the disk
IMMEDIATELY — no confirmation, no dry-run. delete is a REAL unlink: unlike
every other cvm noun there is no archive and no restore, the bytes are gone.

Unlike other write verbs, file does NOT require the CVM server to be running
(there is no database mutation to back up).

Verbs (flags come BEFORE the positional args — a flag after them exits 3):
  list   --video <id>                    Every file, recursively
  add    --video <id> [flags] <path…>    Copy local files in
  get    --video <id> <path>             Read one file's contents back
  delete --video <id> <path>             Unlink one file

An unknown or archived --video is a not-found (exit 2).

Examples:
  cvm file list --video vid_123
  cvm file add --video vid_123 ./notes.md
  cvm file get --video vid_123 notes.md | jq -r .content
  cvm file delete --video vid_123 notes.md`;

export const LIST_HELP = `List every file attached to a Video as NDJSON (one compact JSON object per
line; no files prints nothing, exit 0). Requires --video <videoId>.

The walk is RECURSIVE — nested files are listed with their relative path
("notes/snippet.md"), sorted by path. Dotfiles (.DS_Store, .git…) and
node_modules/.vite are skipped, and so are symlinks and other non-files.

Each line carries:
  path            relative to the Video's directory, POSIX-separated
  size            bytes
  defaultEnabled  whether the writer ticks this file by default (true for
                  ts/tsx/js/jsx/json/md/mdx/txt/csv, by extension)

This is exactly the set of files the Article Writer sees, so it is the way to
check what context a video actually carries.

Examples:
  cvm file list --video vid_123
  cvm file list --video vid_123 | jq -r 'select(.defaultEnabled) | .path'
  cvm file list --video vid_123 | jq -s 'map(.size) | add'`;

export const ADD_HELP = `Copy one or more files from the local filesystem into a Video's directory.
Requires --video <videoId> and at least one source <path>.

Sources are read from disk and COPIED (never symlinked, so a temp file being
cleaned up later cannot empty the attachment). Each file lands under the
Video's directory keeping its BASENAME, unless --as renames it.

Flags:
  --as <name>   store under this name instead of the source basename. May
                contain subdirectories ("notes/snippet.md") — missing parent
                directories are created. Only legal with a SINGLE source path
                (passing it with several is invalid input, exit 3).
  --force       overwrite a file that already exists at the target name.
                Without it, an existing target is invalid input (exit 3) —
                which is also how you 'update' a file: re-add it with --force.

Adding a single file echoes its entry ({ path, size, defaultEnabled }) as one
pretty JSON object; adding several echoes them as NDJSON.

A missing/unreadable source path, or a target that escapes the Video's
directory (absolute, or climbing out with ..), is invalid input (exit 3).

Examples:
  cvm file add --video vid_123 ./notes.md
  cvm file add --video vid_123 ./a.ts ./b.ts ./readme.md
  cvm file add --video vid_123 --as notes/snippet.md /tmp/scratch.md
  cvm file add --video vid_123 --force ./notes.md`;

export const GET_HELP = `Read a single attached file's contents back. Requires --video <videoId> and
the file's <path> RELATIVE to the Video's directory (as printed by
'cvm file list' — e.g. "notes/snippet.md", not an absolute path).

Echoes one pretty JSON object: { videoId, path, size, defaultEnabled, content }.
'content' is decoded as UTF-8 text, so this verb is for TEXT files — reading a
binary attachment (an image) back will produce replacement characters.

An unknown path is a not-found (exit 2). A path that escapes the Video's
directory is invalid input (exit 3).

Examples:
  cvm file get --video vid_123 notes.md
  cvm file get --video vid_123 notes/snippet.md | jq -r .content`;

export const DELETE_HELP = `Delete a single attached file. Requires --video <videoId> and the file's
<path> relative to the Video's directory.

This is a REAL unlink, not an archive: unlike every other cvm noun there is no
archived flag, no listing it afterwards and no restore. Immediate — there is no
confirmation prompt (this is an agent-facing tool). Empty parent directories
are left behind.

Echoes { videoId, path, deleted: true }. An unknown path is a not-found
(exit 2); a path that escapes the Video's directory is invalid input (exit 3).

Example:
  cvm file delete --video vid_123 notes/snippet.md`;
