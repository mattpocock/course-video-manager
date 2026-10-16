---
status: accepted
---

# A Short's Clip Mockups are composed by CVM, one Camera moment then Code

Until now **Clip Mockups** were for **Landscape** Videos only: `cvm clip-mockup add` refused a **Short**, so a Short had no **Animatic** to watch before filming. Every frame was the agent's own 1920x1080 page.

A Short is a vertical 1080x1920 video with a fixed layout, the one the CVM recorder films (`app/packages/scene-layout`, ADR 0021 for the format). Its **Camera** scene is the author full frame. Its **Code** scene is the screen as a 1080x1080 square at the top, with a 1080x840 camera band below. Every Short Matt makes opens on camera with the hook, then goes to the screen and stays there.

## Decision

- **A Short has Clip Mockups, and an Animatic, the same way a Landscape Video does.** The same rows, the same voice (Kokoro, unchanged), the same player and the same Animatic tab in the editor. The player plays at 9:16 (`VIDEO_FORMAT_DIMENSIONS`), and its subtitles sit where the finished Short's captions sit (the overlay renderer's centred position, 122px below the middle), cut at the Short's own phrase length.
- **CVM composes every frame of a Short.** The agent never draws a whole 1080x1920 frame. The page CVM captures is built from the Short layout's own rects (`services/short-clip-mockup-frame.ts`), at a 1080x1920 viewport:
  - **Camera**: a head icon on a blank frame, with a faint "advert" box in the bottom half, where the finished Short draws its call to action. The agent gives no picture for it.
  - **Code**: the agent's HTML page (in an iframe, at exactly 1080x1080) or PNG fills the screen square, and CVM draws the camera band with a head icon below it.
- **The order is fixed: the first Clip Mockup is Camera, every later one is Code.** Each `add` entry on a Short says which with `"scene": "camera" | "code"`. `add`, `update`, `move` and `delete` all refuse a write that would break the order: a Code moment first, a second Camera, a picture on the Camera moment, moving a Code moment above the Camera (or the Camera away from the top), or deleting the Camera while Code moments follow it.
- **The scene is not stored.** Because every write keeps the order, a Short's Clip Mockup's scene is its position, and the composed frame already shows it. No column was added.

## Considered

- **A `scene` column on `clip_mockup`.** It would let a Short hold any order, but no Short wants any other order, and a column is a migration (ADR 0026) for a fact the position already carries. If Shorts ever need a second Camera moment, this is where to go.
- **Let the agent draw the whole 1080x1920 frame.** Rejected: an agent that draws the camera band can put code where Matt's face goes, or cover the advert's place, and the Animatic stops predicting the Short.
- **Two capture passes (the page at 1080x1080, then the frame around the PNG).** An iframe in one page does the same in one capture, and the capture waits for web fonts in every frame.

## Consequences

- The Clip Mockup daemon's capture request carries a viewport per page (1920x1080 or 1080x1920); the daemon's version changes with it (ADR 0031).
- `cvm clip-mockup capture --short` previews a page as a Short's Code frame.
- A Video whose format is changed to Short after it has Landscape Clip Mockups keeps them as they are; the order rule applies to the next write.
