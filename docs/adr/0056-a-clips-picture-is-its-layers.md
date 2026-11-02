---
status: accepted
---

# A Clip's picture is its Layers

Decided on 2026-11-02 (spec #2572, Matt's grilling, "Looks great"; prefactor #2573).

## Context

A Short cut from a live stream needs a picture the scene layout can't draw: the stream's screen cropped to a square at the top and the camera cropped to the face below. Today a **Clip**'s picture is one thing, its source drawn in a scene layout: an OBS or **Imported Footage** file, or a **Recording Session**'s camera and screen in its **Video Format**'s layout. The only footage-on-footage tool is the **B-roll** **Overlay Kind**. It is full frame only, and it is an Overlay rather than part of the Clip's picture. A Streamed Recording Session is always Landscape, so its Clips on a Short are drawn at 1920x1080 and squashed to 1080x1920.

## Decision

1. **A Clip's picture is its Layers, drawn bottom to top.** There is no collective noun: they are "the Clip's Layers". The Kinds are the **Scene Layer** (the scene-layout render every Clip had before) and the **Footage Layer** (one Footage file with a **Source Crop** in 0–1 fractions of the file, a **Placement** in output pixels, a volume and a start time, using B-roll's timing rule: the latest frame at or before start plus elapsed, the same in preview and export).
2. **An untouched Clip is one Scene Layer, implicitly.** A Clip with no Layers stored reads as exactly one Scene Layer, so no backfill is needed. Its export, playback, stills and **Export Hash** are byte for byte what they were. The clip-source package is the one seam: `clipLayers` lists a Clip's Layers, and every picture function (the export's composite, editor playback, stills, the Export Hash fields) draws from them. An untouched Clip adds nothing to the Export Hash.
3. **The Video's format decides the layout.** The Recording Session supplies the Scene Layer's files, scene timeline, mic offset and Mic EQ, but the Scene Layer is drawn in the _Video's_ format. A Landscape-session Clip on a Short draws the Short layout; a Clip with no Recording Session on a Short is scaled to cover and centre-cropped, never stretched (#2575).
4. **Layers are set per Clip, explicitly.** Copying another Clip's Layers is a copy; nothing is linked. Layers are copied with their Clip on every copy path.
5. **Overlays are graphics only, and always draw above every Layer**, with the captions above them.
6. **The B-roll Overlay Kind is removed.** Every B-roll becomes Footage Layers (full-frame Placement, whole-frame Source Crop, volume 0, start carried across the Clips its window covers), on Landscape Videos too (#2576). Its picture stays identical; the Export Hash of a migrated Video may change once.
7. **On a Short any mix of Layers is allowed**, including no Scene Layer. **On a Landscape Video only a Scene Layer at the bottom with Footage Layers above it**, until the follow-up spec for full custom Layers on Landscape (#2582). Anything else is refused.

## Considered

- **A new Overlay Kind for cropped footage.** Rejected: Overlays sit above the picture and never overlap, so a Short made of two cropped files would be two Overlays fighting one rule, and a Chat Card could not draw above them.
- **Backfilling a Scene Layer row for every Clip.** Rejected: an implicit Scene Layer needs no migration and keeps every Export Hash, and an untouched Clip renders through today's path unchanged.
- **Keeping the Recording Session's format as the layout.** Rejected: it is what stretches a stream Clip on a Short.

## Consequences

- Until Footage Layers can be stored (#2574), `clipLayers` always answers one Scene Layer, and nothing renders, hashes or previews differently.
- A Clip's Layers will join its Export Hash only when they are not one Scene Layer, so no export made before Layers is re-addressed.
- Storage ownership (Used Imported Footage) reads Footage Layers once B-roll is gone.
