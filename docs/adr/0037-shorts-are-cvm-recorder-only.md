---
status: superseded by ADR-0051
---

# Shorts are CVM-recorder only

> Superseded by [ADR 0051](0051-the-cvm-recorder-is-the-only-recorder.md): every Video, not only a Short, records with the CVM recorder.

Decided by Matt on #1993. Builds on [ADR 0036](0036-a-clips-recorder-is-its-own.md).

## Context

A **Short** could open either **Recorder**. On OBS it switched OBS to its `TikTok` profile; on the CVM recorder it films the Spacedesk display as its screen (ADR 0034, decision 9). Matt films Shorts on the CVM recorder and never edits old Shorts.

## Decision

1. **A Short records with the CVM recorder only.** `recordersForFormat("short")` is `["cvm"]`. A new Short, and a Video changed to a Short, stores `cvm`; a Short that stored `obs` reads as the CVM recorder (`resolveVideoRecorder` reads the stored Recorder for the Video's format). `updateVideoRecorder` refuses OBS on a Short.
2. **No OBS option for Shorts in the UI.** The Recorder picker is not shown when there is no choice, and the Shorts studio has no OBS live stream, OBS empty state or OBS Silence Length toggle.
3. **No OBS TikTok profile switching.** The editor keeps OBS on the `Landscape Recording` profile, the only one it now asks for.
4. **Landscape Videos are unchanged:** a new one still defaults to OBS, and the OBS path keeps working.

## Consequences

- Existing OBS-filmed Short Clips still export and play: export is per Clip (ADR 0036), and the editor still shows an OBS Clip filmed in the `TikTok` profile at 9:16, from the Clip's own `profile`.
- Making OBS a Short's Recorder again would mean restoring the profile switch and the Shorts studio's OBS paths.
