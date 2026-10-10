/**
 * Long-form --help text for `cvm diagram`. The SHAPES and VALUES blocks are
 * the format's cheat sheet, and the help is its source of truth for agents:
 * diagram.help.test.ts checks them against the zod schema in
 * `@cvm/core/lib/simple-diagram`, so a field added there and not here fails CI.
 */

export const HELP = `Diagram — a tldraw drawing Matt films against, edited in the Diagram Playground.

An agent DRAFTS a Diagram here in the simple shape format — a short list of
boxes, ellipses, text, arrows, lines and icons in Matt's house style — and
Matt finishes it by hand.

A Diagram is the folder; its drawings are SNAPSHOTS, and a FILMED snapshot
(one a Clip pins) never changes. 'create' keeps each drawing you give it as a Preserved Snapshot, in
order, and opens the Diagram on the FIRST. A batch is a build-up: the steps
Matt walks through on camera, one snapshot each.

To CHANGE a Diagram, never edit it: 'snapshot add' a new drawing. It becomes
a Preserved Snapshot and the Diagram's current drawing (its head) — a Restore
to Head. If Matt drew on the head by hand and no snapshot holds that drawing,
it is preserved first, so nothing he did is lost. To FIX one drawing — an
icon too close to a heading, a label touching its box — 'snapshot update' it
in place instead of adding a near-copy; it refuses a filmed one, and a fix
its undo could not reverse exactly (a removed shape, say).

Verbs:
  create --file <path|->                     WRITE. A new Diagram from a JSON file ("-" = STDIN)
  snapshot add --file <path|-> <diagramId>   WRITE. One more drawing, made the head
  snapshot update --file <path|-> <snapshotId>  WRITE. Redraw one unfilmed snapshot in place
  render <snapshotId>                        READ. Draw a stored snapshot to a PNG
  get [--snapshot <snapshotId>] <diagramId>  READ. The head and the snapshots, as JSON
  list [--archived] [<query>]                READ. Every Diagram, or those matching a search
  component list                             READ. Every Component, with its shapes
  update --name <name> <diagramId>           WRITE. Rename the Diagram; its drawings stay
  delete <diagramId>                         WRITE. Archive the Diagram (undo: 'restore')
  restore <diagramId>                        WRITE. Bring an archived Diagram back

LOOK FIRST. 'list' shows Matt's Diagrams ("filmed" ones he used on camera)
and 'component list' his saved Components, both readable as this format:
'get --snapshot' a filmed one, or copy a Component's shapes, to match his
style before you draw.

THE LOOP. Write the JSON, 'create' it, READ EVERY PNG it prints, fix the JSON
and 'create' again until the pictures are right, then hand Matt the url. Once
he has the url, change it with 'snapshot add', never a second 'create'. To
see what Matt has drawn since, 'get' it first, change what you need in the
head's shapes, and 'snapshot add' them: it applies them ONTO the head, so all
he did by hand is kept. 'update' changes the NAME only. To fix a layout bug in
one snapshot, 'get --snapshot' it, change those shapes, and 'snapshot update'
it: same id, same place in the timeline, and it prints the drawing it
replaced so a bad fix can be undone exactly.

FORMAT. One JSON object — ONE drawing:
  { "name"?: "Auth flow", "shapes": [ ...shapes ] }
or a BATCH of drawings, first to last:
  { "name"?: "Auth flow", "snapshots": [ { "shapes": [...] }, { "shapes": [...] } ] }
"name" is the Diagram's name (default "Untitled N"). Every shape has a "type"
and an "id" you choose — letters, digits, "_" or "-", unique in its drawing.
In a batch, keep a shape's id from one snapshot to the next and every
snapshot must differ from the others. A drawing holds at most 500 shapes,
and every number is within ±100000.

SHAPES ("?" = optional; leave a field out to get Matt's default)
  box      id, x, y, w, h, color?, fill?, dash?, opacity?
  ellipse  id, x, y, w, h, color?, fill?, dash?, opacity?
  text     id, x, y, text, size?, scale?, color?, rotation?, opacity?
  arrow    id, from? | x1?, y1?, to? | x2?, y2?, text?, bend?, heads?, color?, dash?, opacity?
  line     id, x1, y1, x2, y2, color?, dash?, opacity?
  icon     id, x, y, name, color?, opacity?
  other    id   (only from 'get'; 'snapshot add' keeps it, so does 'update'; 'create' refuses it)

WHAT THE FIELDS MEAN
  x, y       the top-left corner, in canvas pixels; y grows DOWN. A Diagram
             is filmed in a 16:9 frame: lay it out inside about 1600x900.
  w, h       a box's or ellipse's width and height (> 0).
  text       a text shape's words; "\\n" starts a new line. On an arrow, a
             label drawn on its middle.
  box text   a box or ellipse has NO text inside. Put a separate text shape
             over it, as Matt does. Text at size m and scale 1 is about
             13px wide per character and 32px tall per line (both times
             its scale), so centre it by eye.
  from, to   an arrow end ATTACHED to another shape's id (box, ellipse, text
             or icon — not an arrow or line, and not the arrow's other end's
             shape). It meets that shape's outline
             and follows it when Matt moves the shape. Give each end EITHER
             from/to OR its free point: x1, y1 for the start, x2, y2 for the
             end.
  bend       how far the arrow's middle bows sideways, in pixels (0 =
             straight; try 30 to 80; negative bows the other way).
  heads        which ends carry an arrowhead.
  rotation   degrees, clockwise — for a hand-written aside, tilt it a few.
  scale      a text's size multiplier, as tldraw's own: any number from
             0.01 to 100 (default 1). Matt sizes text this way far more than
             by size: about 0.5 to 0.75 for a description under a heading,
             2 to 2.5 for a title. 'get' prints it exactly as stored.
  name       an icon's Lucide name, e.g. "database", "user", "bot",
             "search", "flag", "wrench", "code-xml". An unknown name is
             refused. Icons are 48x48.
  line       a straight two-point line: a divider or an underline.

VALUES (default marked)
  color     black (default), grey, light-violet, violet, blue, light-blue, yellow, orange, green, light-green, light-red, red, white
  fill      none (default), semi, solid, pattern, fill, lined-fill
  dash      draw (default), solid, dashed, dotted, none
  size      s, m (default), l, xl
  heads     end (default), both, none
  opacity   0.1, 0.25, 0.5, 0.75, 1 (default)

Matt's style, already the defaults: the hand-drawn font, size m, the "draw"
dash, black, no fill, fully opaque. Colour is for meaning — one lit box, not a
rainbow. Opacity 0.5 fades a description under its heading.
Keep it SMALL: about 10 shapes.

EXAMPLE
  {
    "name": "Agent loop",
    "shapes": [
      { "type": "box", "id": "agent", "x": 0, "y": 0, "w": 220, "h": 120 },
      { "type": "text", "id": "agent-label", "x": 70, "y": 44, "text": "Agent" },
      { "type": "box", "id": "tools", "x": 420, "y": 0, "w": 220, "h": 120, "color": "light-blue", "fill": "semi" },
      { "type": "text", "id": "tools-label", "x": 492, "y": 44, "text": "Tools" },
      { "type": "arrow", "id": "call", "from": "agent", "to": "tools", "text": "call", "bend": 40 },
      { "type": "arrow", "id": "result", "from": "tools", "to": "agent", "bend": 40 },
      { "type": "icon", "id": "bot", "x": 86, "y": -70, "name": "bot" },
      { "type": "line", "id": "rule", "x1": 0, "y1": 200, "x2": 640, "y2": 200, "dash": "dashed" },
      { "type": "text", "id": "aside", "x": 440, "y": 220, "text": "runs until done", "size": "s", "rotation": -5 },
      { "type": "text", "id": "caption", "x": 0, "y": 240, "text": "The agent calls tools in a loop.", "scale": 0.7, "opacity": 0.5 }
    ]
  }

LOCAL-ONLY. The PNGs are drawn by the Clip Mockup daemon's headless browser on
the author's machine, through the running Course Video Manager app
(CVM_APP_URL, default http://localhost:5173). Elsewhere 'create', 'snapshot
add', 'snapshot update' and 'render' are refused before doing anything: _tag
"LocalOnlyCommandError", exit 7. Stop; do not retry. 'get', 'list',
'component list', 'update', 'delete' and 'restore' draw nothing and run
anywhere.

Examples:
  cvm diagram create --file agent-loop.json
  cat agent-loop.json | cvm diagram create --file -
  cvm diagram snapshot add --file agent-loop-v2.json <diagramId>
  cvm diagram snapshot update --file fixed.json <snapshotId>
  cvm diagram render <snapshotId>
  cvm diagram get <diagramId>
  cvm diagram get --snapshot <snapshotId> <diagramId>
  cvm diagram list agent
  cvm diagram component list
  cvm diagram update --name "Agent loop" <diagramId>
  cvm diagram delete <diagramId>
  cvm diagram restore <diagramId>`;

export const CREATE_HELP = `WRITE. Create a NEW Diagram from a simple-format JSON file: each drawing in it
becomes a Preserved Snapshot, in order, and the Diagram opens on the FIRST.
Each is drawn as a PNG, and the command prints where to look.

  cvm diagram create --file <path|->

  --file <path|->   the Diagram as JSON — one drawing {name?, shapes} or a
                    batch {name?, snapshots: [{shapes}, …]} (see
                    'cvm diagram --help' for the format). "-" reads STDIN.

Output: ONE NDJSON line,
  {"id":"…","url":"http://localhost:5173/diagram-playground/…",
   "snapshots":[{"id":"…","image":"/tmp/…/….png"}, …]}
  id         the new Diagram's id.
  url        where Matt opens it in the Diagram Playground — hand him this.
  snapshots  one per drawing, in the file's order; the first is what the
             Diagram shows when Matt opens it.
    id       the DiagramSnapshot's id.
    image    the PNG of that drawing: dark mode, dark background. READ
             EVERY ONE before you hand the url over.

Order: the file is checked, then drawn, then written. Nothing is written
unless all three succeed, so a failed 'create' can simply be run again.

Exit codes:
  3  invalid input — EVERY problem at once, each naming its shape (and, in a
     batch, its snapshot): an unknown type, field or icon; an arrow pointing
     at a missing id or at a line, or at one shape from both ends; both or
     neither of "from" and x1, y1; a duplicate id; more than 500 shapes; a
     number beyond ±100000; both "shapes" and "snapshots"; an empty batch;
     two snapshots that draw the same thing.
  4  the PNG could not be drawn (_tag DiagramRenderError) — usually the app
     is not running at CVM_APP_URL. Nothing is written.
  7  not the author's machine (_tag LocalOnlyCommandError). Stop.

Examples:
  cvm diagram create --file agent-loop.json
  cvm diagram create --file agent-loop.json | jq -r '.snapshots[].image'
  echo '{"shapes":[{"type":"box","id":"a","x":0,"y":0,"w":200,"h":100}]}' | cvm diagram create --file -`;

export const SNAPSHOT_HELP = `A Diagram's snapshots: its drawings. A filmed one never changes.

Verbs:
  add --file <path|-> <diagramId>       WRITE. One more drawing, made the head
  update --file <path|-> <snapshotId>   WRITE. Redraw one unfilmed snapshot in place

See 'cvm diagram snapshot add --help' and 'cvm diagram snapshot update --help'.`;

export const SNAPSHOT_ADD_HELP = `WRITE. Add ONE drawing to an existing Diagram as a Preserved Snapshot and make
it the Diagram's head (a Restore to Head). This is how a Diagram moves on: a
new step is added. (To fix one drawing in place, see 'snapshot update'.) It is drawn as a PNG, and the
command prints where to look.

  cvm diagram snapshot add --file <path|-> <diagramId>

  <diagramId>       the Diagram: its id, or its playground url.
  --file <path|->   the drawing as JSON, { "shapes": [...] } — no "name" (the
                    Diagram has one) and no "snapshots" (one at a time). See
                    'cvm diagram --help' for the format. "-" reads STDIN.

The drawing is applied ONTO the head, matched by id, and the result is the
new snapshot. Start from 'cvm diagram get' and change only what you mean to:
  - a shape you list keeps everything the format cannot say — an icon Matt
    resized, a font, a text's wrapping width, a stroke size, an arrow end
    he dragged — and takes the fields you give it;
  - a shape you leave out is removed;
  - a new id is drawn in Matt's defaults;
  - an "other" shape is kept as it is, listed or not; an "other" whose id the
    head does not have is refused.

Nothing is lost. If no snapshot in the Diagram's timeline holds its current
drawing — Matt drew on it by hand — that drawing is preserved FIRST, then the
new one is added and restored. If Matt has the Diagram open, the playground
offers him "Reload" or "Keep my edits".

Output: ONE NDJSON line,
  {"snapshotId":"…","image":"/tmp/…/….png"}
  snapshotId  the new DiagramSnapshot's id; the Diagram's head is now this.
  image       the PNG of the drawing: dark mode, dark background. READ IT.

Order: the Diagram is looked up, the file checked and applied onto its head,
the drawing drawn, then written. Nothing is written unless all succeed. Adding a drawing the Diagram
already has re-uses that snapshot.

Exit codes:
  2  no Diagram with that id (_tag NotFoundError).
  3  invalid input — EVERY problem at once, each naming its shape: as for
     'create', plus an "other" the head does not have.
  4  the PNG could not be drawn (_tag DiagramRenderError) — usually the app
     is not running at CVM_APP_URL. Nothing is written.
  7  not the author's machine (_tag LocalOnlyCommandError). Stop.

Examples:
  cvm diagram snapshot add --file agent-loop-v2.json 3f2a…
  cvm diagram snapshot add --file - 3f2a… < agent-loop-v2.json | jq -r .image`;

export const RENDER_HELP = `READ. Draw one stored DiagramSnapshot to a PNG and print where it is. It draws
a SNAPSHOT — never the head, which Matt may be mid-way through editing.

  cvm diagram render <snapshotId>

Output: ONE NDJSON line,
  {"snapshotId":"…","image":"/tmp/…/….png"}
  snapshotId  the snapshot drawn.
  image       its PNG: dark mode, dark background, <snapshotId>.png.

Exit codes:
  2  no snapshot with that id (_tag NotFoundError).
  4  the PNG could not be drawn (_tag DiagramRenderError) — usually the app
     is not running at CVM_APP_URL.
  7  not the author's machine (_tag LocalOnlyCommandError). Stop.

Examples:
  cvm diagram render 9c41…
  cvm diagram render 9c41… | jq -r .image`;

export const GET_HELP = `READ. Print a Diagram's current drawing (its head) and its snapshots, the
drawings in the simple shape format of 'cvm diagram --help'. Writes nothing.

  cvm diagram get [--snapshot <snapshotId>] <diagramId>

  <diagramId>              the Diagram: its id, or its playground url.
  --snapshot <snapshotId>  print just this snapshot's drawing instead.

Output: ONE NDJSON line,
  {"id":"…","name":"…","archived":false,"url":"…","head":{"shapes":[…]},
   "snapshots":[{"id":"…","preserved":true,"clipIds":[…],"diagramText":"…","createdAt":"…"}, …]}
  id           the Diagram's id.
  name         its name.
  archived     true once 'delete' has archived it (see 'restore').
  url          where Matt opens it in the Diagram Playground.
  head         what the Diagram shows now — Matt may have drawn on it by hand.
  snapshots    its timeline, oldest first (archived ones left out).
    id           the DiagramSnapshot's id; 'render' draws it.
    preserved    a Preserved Snapshot: kept even when no Clip pins it.
    clipIds      the Clips that pin it, filmed against this drawing.
    diagramText  every word on its shapes, in one line.
    createdAt    when it was taken.

With --snapshot, ONE NDJSON line,
  {"snapshotId":"…","shapes":[…]}
  snapshotId  the snapshot.
  shapes      its drawing.

A shape the format cannot say — a hand-drawn stroke, a sticky note, a shape
in a group or frame — comes back as {"type":"other","id":"…"}. 'snapshot add'
keeps every "other" as it is, so you can pass the head back whole: change the
shapes you mean to and leave the "other"s alone. You cannot change or remove
one; tell Matt instead.

Exit codes:
  2  no Diagram with that id, or no snapshot with that id in this Diagram
     (_tag NotFoundError).

Examples:
  cvm diagram get 3f2a…
  cvm diagram get 3f2a… | jq '.head.shapes'
  cvm diagram get --snapshot 9c41… 3f2a…`;

/** What 'update', 'delete' and 'restore' each print: the Diagram, not its drawings. */
const WRITE_OUTPUT = `Output: ONE NDJSON line,
  {"id":"…","name":"…","archived":false,"url":"…"}
  id        the Diagram's id.
  name      its name.
  archived  true while it is archived (deleted).
  url       where Matt opens it in the Diagram Playground.`;

export const UPDATE_HELP = `WRITE. Rename a Diagram. This is ALL 'update' does: it never changes the
head or any snapshot — to change the drawing, 'snapshot add' a new one, or
'snapshot update' one that was not filmed. It is
the same rename as editing the name in the Diagram Playground.

  cvm diagram update --name <name> <diagramId>

  <diagramId>     the Diagram: its id, or its playground url.
  --name <name>   the new name. Trimmed; it cannot be empty.

${WRITE_OUTPUT}

Exit codes:
  2  no Diagram with that id (_tag NotFoundError).
  3  --name is empty.

Examples:
  cvm diagram update --name "Agent loop" 3f2a…`;

export const DELETE_HELP = `WRITE. Delete a Diagram — an ARCHIVE, exactly as the Diagram Playground's
delete: the Diagram leaves Playground Home, the playground's list and its
search, but nothing is removed. Its head and its snapshots stay as they are,
Clips that pin its snapshots keep them, and 'restore' brings it back.

  cvm diagram delete <diagramId>

  <diagramId>   the Diagram: its id, or its playground url.

${WRITE_OUTPUT}

Deleting an archived Diagram again changes nothing.

Exit codes:
  2  no Diagram with that id (_tag NotFoundError).

Examples:
  cvm diagram delete 3f2a…
  cvm diagram restore 3f2a…   # undo`;

export const RESTORE_HELP = `WRITE. Restore an archived Diagram: undo 'delete'. It is back on Playground
Home with its head and every snapshot as they were when it was deleted.
(Not a Restore to Head: that loads a snapshot onto the head and is done with
'snapshot add'.)

  cvm diagram restore <diagramId>

  <diagramId>   the Diagram: its id, or its playground url.

${WRITE_OUTPUT}

Restoring a Diagram that is not archived changes nothing.

Exit codes:
  2  no Diagram with that id (_tag NotFoundError).

Examples:
  cvm diagram restore 3f2a…`;
