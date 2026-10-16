/**
 * The Short part of 'cvm clip-mockup add --help': how a Short's Animatic is
 * composed and the order its Clip Mockups must keep. Split out of
 * clip-mockup.help.ts to keep that file under the per-file token budget.
 */
export const SHORT_ADD_HELP = `A SHORT. A Short is a vertical video, and its Animatic is too: every frame is
1080x1920, and CVM composes it from the Short's own layout — the one the
recorder films — so the picture always sits where the finished Short's does.
You never draw the whole frame, and you cannot break the layout. Two scenes:
  { "say": "<line>", "scene": "camera" }
      The Camera moment: Matt to camera, the Short's hook. CVM draws it — a
      head on a blank frame, with a faint box in the bottom half where the
      finished Short puts its advert. It takes NO "html" or "image".
  { "say": "<line>", "scene": "code", "html": "<page.html>" }   (or "image")
      A Code moment: your page fills the 1080x1080 SCREEN SQUARE at the top,
      and CVM draws the camera band (1080x840) below it. Write the page for a
      1080x1080 viewport — it is drawn at exactly that size, in a frame of its
      own; an image is fitted into the square. Preview it with
      'cvm clip-mockup capture --short <page.html>'.
THE ORDER IS FIXED: Clip Mockup 1 is the Camera moment, and every one after it
is Code. So the first 'add' to a Short starts with ONE "scene": "camera"
entry, and every later entry, in that file or any later one, is "code". A
missing "scene", a Code moment first, a second Camera, or a picture on a
Camera moment is invalid input (exit 3), naming the entry, before anything is
captured. ('move' and 'delete' keep the Camera moment first, too.)
The square is small and seen on a phone: one idea per frame, big type, and
DIAGRAMS over walls of code — boxes and arrows, a type drawn as a shape, a
before/after split, a highlighted line or two of real code. Be inventive:
the screen square is yours, and a Short lives or dies on its pictures.

Example — a Short, frames/short.json:
  [
    { "say": "Here's a TypeScript trick nobody uses.", "scene": "camera" },
    { "say": "Say you've got this object.", "scene": "code", "html": "01.html" },
    { "say": "Add satisfies, and watch the type.", "scene": "code", "html": "02.html" }
  ]
`;
