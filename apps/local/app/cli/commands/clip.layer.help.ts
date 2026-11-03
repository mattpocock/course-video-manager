/**
 * Long-form --help text for `cvm clip layer`, beside clip.layer.ts.
 */

export const LAYER_HELP = `clip layer — a Clip's Layers: its picture, drawn bottom to top.

A Clip's picture is its Layers. Index 0 is the bottom; each Layer above draws over it.
  - Scene Layer: the Clip's own source in its scene layout (what every Clip had before
    Layers). It carries the Clip's own sound (the mic, or its file's sound) at its volume.
  - Footage Layer: one Footage file: a Source Crop of it (x,y,w,h as 0-1 fractions of its
    frame) scaled to a Placement (x,y,w,h in output pixels: 1080x1920 on a Short,
    1920x1080 on Landscape), with a volume (0 = muted, the default) and a start time.
    It plays along with the Clip: at t seconds into its span it shows the Footage at
    start + t. '--footage camera' or '--footage screen' names the Clip's own Recording
    Session's file instead, already in sync with the Clip (no --from).
A Clip with no Layers set is one Scene Layer at volume 1, and renders exactly as it always did.
Overlays and captions always draw above every Layer. The Source Crop is scaled to the
Placement's size as it is, so give them the same aspect ratio or the picture stretches.

Where: on a Short any mix (a Scene Layer alone, Footage Layers over it, or Footage Layers
only). On a Landscape Video only a Scene Layer at the bottom with Footage Layers above it.
Anything else is refused (exit 3), as are a Source Crop outside 0-1, a Placement with no
area, a volume outside 0-1, camera/screen on a Clip with no Recording Session, an unknown
Footage path, and a Clip whose Version is not a Draft. Every Layer field is in the Export
Hash: changing one marks the Video for re-export.

Verbs (flags go BEFORE the positionals):
  clip layer list <clip>                      its Layers, bottom to top (NDJSON, with 'index')
  clip layer add [flags] <clip>               add a Footage Layer on top (--scene: a Scene Layer)
  clip layer update [flags] <clip> <index>    change a Layer's fields
  clip layer move --to <i> <clip> <index>     move a Layer to index <i>
  clip layer remove <clip> <index>            remove a Layer (a Clip keeps at least one)
  clip update --layers-from <clip> <clip...>  copy one Clip's Layers onto others (a copy; nothing linked)
Each write prints the Clip's Layers after it (NDJSON). Two edits of one Clip's Layers at
once never lose either: a write whose Layers another command changed after it read them
is refused (exit 8, _tag "ClipLayersChangedError") and writes nothing. Run it again; it
reads the Layers as they are now, so re-check the index you meant.

Recipe — a stream Clip on a Short: the screen's left square on top, the face below.
  cvm footage frame <camera-file> --at <t>      # look at the frames to choose crops
  cvm clip layer add --footage screen --crop 0,0,0.5625,1 --place 0,0,1080,1080 <clip>
  cvm clip layer add --footage camera --crop 0.14,0,0.72,1 --place 0,1080,1080,840 <clip>
  cvm clip layer remove <clip> 0                # drop the Scene Layer: Footage Layers only
  cvm clip layer list <clip>
  # the same layout on every other Clip of the Short:
  cvm clip list --video <short> | jq -r '.id' | xargs cvm clip update --layers-from <clip>
  cvm clip frame <clip> --at 1                  # check the composed frame

Recipe — B-roll: Imported Footage over the whole frame for part of a Clip, muted, the
Clip's own sound playing on (a B-roll that runs on into the next Clip is one Layer per Clip,
each --from carried on by how far into the B-roll that Clip starts).
  cvm clip layer add --footage raw-footage/imported/city.mp4 --from 12.5 --at 3 --duration 4 <clip>`;

export const LAYER_LIST_HELP = `List a Clip's Layers, bottom (index 0) to top, as NDJSON.

Each line is { index, kind, volume, ... }. A Footage Layer adds 'source' ({ kind: "file", path,
start } or { kind: "session", file: "camera" | "screen" }), 'sourceCrop' and 'placement'
({ x, y, w, h }) and 'span' ({ at, duration } in seconds into the Clip, or null for the whole
Clip). A Clip with no Layers set lists one Scene Layer at volume 1.

Example:
  cvm clip layer list clip_abc | jq 'select(.kind == "footage")'`;

export const LAYER_ADD_HELP = `Add a Layer on top of a Clip's Layers.

A Footage Layer needs --footage <path|camera|screen>. Its other fields default to the whole
Footage frame (--crop 0,0,1,1) over the whole of the Video's frame (--place), volume 0 (muted)
and the whole Clip (no --at/--duration). --from <s> is where in a Footage file it starts
(default 0). A path is Footage on this machine (root-relative or absolute), stored
root-relative, so it is local-only. --scene adds a Scene Layer instead (only --volume).

Examples:
  cvm clip layer add --footage screen --crop 0,0,0.5625,1 --place 0,0,1080,1080 clip_abc
  cvm clip layer add --footage raw-footage/imported/city.mp4 --from 12 --at 1 --duration 3 clip_abc
  cvm clip layer add --scene clip_abc`;

export const LAYER_UPDATE_HELP = `Change the fields of a Clip's Layer <index>, keeping the rest.

The same flags as 'clip layer add'. A Scene Layer takes only --volume. --at and --duration
go together.

Examples:
  cvm clip layer update --volume 0.5 clip_abc 1
  cvm clip layer update --place 0,1000,1080,920 clip_abc 2`;

export const LAYER_MOVE_HELP = `Move a Clip's Layer <index> to --to <i> (0 is the bottom).

On a Landscape Video the Scene Layer must stay at the bottom.

Example:
  cvm clip layer move --to 0 clip_abc 2`;

export const LAYER_REMOVE_HELP = `Remove a Clip's Layer <index>.

A Clip keeps at least one Layer. Removing a Short Clip's Scene Layer leaves Footage Layers
only; a Landscape Clip keeps its Scene Layer.

Example:
  cvm clip layer remove clip_abc 0`;
