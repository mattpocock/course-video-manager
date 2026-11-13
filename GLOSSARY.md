# Course Video Manager

A tool for authoring courses as structured collections of sections, lessons, and videos, and for publishing them as immutable releases of finished videos plus a description of the course.

## Language

### Course structure

**Course**:
A structured collection of versions, sections, lessons and videos.
_Avoid_: Repo, Project

**Section**:
An ordered group of Lessons within a Course Version.
_Avoid_: Module, Unit

**Lesson**:
A single learning unit within a Section.
_Avoid_: Exercise, Tutorial, Step

**Learning Goal**:
One thing a learner should come away knowing from a **Section**, written before its Lessons and Beats are planned. Every **Beat** in the Section should serve at least one.
_Avoid_: Objective, Outcome

### Course versions

**CourseVersion**:
A snapshot of a course's section, lesson and video structure, which moves from Draft to Pending to Published.
_Avoid_: Version (too vague), Revision

**Draft Version**:
The one CourseVersion of a course that can still change.
_Avoid_: Current version, Working version

**Lineage**:
What makes a **Section**, **Lesson** or **Video** "the same one" across CourseVersions, even though each version has its own copy.
_Avoid_: Stable id, Original id

**Pending Version**:
A submitted CourseVersion whose release has not yet been confirmed as landed. It is either Promoted or Discarded.
_Avoid_: Frozen version, In-flight version

**Published Version**:
An immutable, named CourseVersion whose release landed.
_Avoid_: Released version, Committed version

**Submit**:
Turning the Draft into a Pending Version with a name and description, and starting a fresh Draft from it.
_Avoid_: Freeze, Snapshot

**Promote**:
Turning a Pending Version into a Published Version once its release has landed.
_Avoid_: Finalize, Confirm

**Discard**:
Throwing away a Pending Version whose release did not land. Its content lives on in the fresh Draft.
_Avoid_: Rollback, Delete version

**Publish**:
The whole release flow: **Submit**, render and upload the videos, then **Promote**.
_Avoid_: Commit, Deploy, Push

**Bundle**:
What a **Publish** produces: one immutable release holding every shipping Video and a description of the course.
_Avoid_: Asset folder, Release folder, Blob pool

**Publish Readiness**:
The answer to "what stands between this Course and shipping?": the outstanding work on the Lessons that would ship in full.
_Avoid_: Publish status, Readiness check, Blockers

**Lesson Publish Status**:
What a **Publish** does with one **Lesson**: ships it in full, ships it as a **Placeholder Lesson**, or withholds it.
_Avoid_: Publish Fate, Lesson state, Effective lesson

**Placeholder Lesson**:
A **Lesson** in a release with a title and nothing else, so learners can see what is coming before it is filmed.
_Avoid_: Coming Soon Lesson, Stub lesson, Ghost Lesson, Empty lesson

**Text Lesson**:
A **Lesson** that is written, not filmed: its Video has an article and no Clips.
_Avoid_: Article lesson, Video-less lesson

**Optional Lesson**:
A **Lesson** a learner may skip and still finish the Course.
_Avoid_: Bonus lesson, Extra, Elective

**Placeholder Floor**:
The author's choice, for one Publish, of how far down the Lesson priorities unfinished Lessons are announced as **Placeholder Lessons**.
_Avoid_: Priority cutoff, Announce level, Publish depth, Preview mode

**Autofill**:
A pass that writes every missing description and missing **Chapters** for the Videos about to ship, with no review step.
_Avoid_: Generate, Suggest, Auto-publish, Batch generate

### Authoring lifecycle

**Lesson Authoring Status**:
Whether the author considers a **Lesson** todo or done.
_Avoid_: TODO flag, Completion

**Marked Ready** / **Marked TODO**:
The changelog groups for Lessons whose **Lesson Authoring Status** changed between **Published Versions**.
_Avoid_: Completed, Reopened

### Video and clips

**Video**:
A container of clips and chapters that represents a single producible video output.
_Avoid_: Recording

**Standalone Video**:
A Video that belongs to no Lesson. Every Short is one.
_Avoid_: Orphan video, Unlinked video

**Video Format**:
Whether a **Video** is a Landscape (horizontal, long-form; the default) or a Short (vertical, posted to YouTube Shorts and TikTok).
_Avoid_: Standard (the old name for Landscape), TikTok (the platform, never the name for a Short)

**Clip**:
A segment of **Footage** within a Video, from a start time to an end time. A Clip is what was filmed; a **Clip Mockup** is what was planned.
_Avoid_: Segment, Cut, Take

**Clip Origin**:
How a **Clip** came to exist: filmed in the video editor, created by the CLI, or copied. Only filmed Clips count as new footage.
_Avoid_: Clip Source, Recorder

**Footage**:
A raw source video file, such as a camera capture or a screen recording, before it is cut into **Clips**.
_Avoid_: Raw footage, Source video

**Imported Footage**:
**Footage** CVM did not film, brought in from a file or from YouTube.
_Avoid_: External footage, Uploaded footage

**Chapter**:
A named divider in a Video's timeline that groups the Clips below it. Maps one to one to YouTube chapters.
_Avoid_: Clip group, Divider, Marker, Section, Clip Mockup Chapter

**Video Post**:
A record of a **Video** being posted to an external platform: which platform, where, and when.

**YouTube Draft**:
The title and description written for a **Video** on its YouTube page, kept on the Video and saved as they are typed, until the upload sends them.
_Avoid_: Post draft, Stored title

**Take**:
One stretch of speech the **Recorder** hears that is long enough to become a **Clip**.
_Avoid_: Speech part, Sound detection

**Clip Web Link**:
A web page that was on screen while a **Clip** was recorded.
_Avoid_: Link, Clip URL

**Transcript**:
The ordered text of a **Video**: its **Clips** and **Chapters** together, in timeline order.
_Avoid_: Clip text, Joined clips, Caption

**Video File**:
A file attached to a **Video** as supporting material for writing its article, such as code samples or notes.
_Avoid_: Attachment, Asset

### On-screen sessions

**Agent Session**:
A Claude Code session that was on screen while **Clips** were filmed.
_Avoid_: Session, Conversation

**Agent Session Entry**:
One thing an **Agent Session** showed on screen, such as a prompt or a reply, tied to the moment in a **Clip** it appeared.
_Avoid_: Message, Event, Line

### Video planning

**Beat**:
A single planning unit of a **Video**, classified by the job it does for the viewer. A Beat is what was planned; a **Chapter** groups what was shot.
_Avoid_: Chapter, Segment, Section, Block, Unit

**Beat Description**:
A free-text planning note on a **Beat**: what the author is actually going to do or say there.
_Avoid_: Notes, Summary, Body, Caption

**Clip Mockup**:
One still image and one spoken line planned for a moment of a **Video**, decided before filming.
_Avoid_: Clip, Beat, Storyboard, Frame, Mockup (unqualified), Slide, Shot

**Animatic**:
A **Video**'s **Clip Mockups** played in order as a timed preview, or read as lines. It is a way of viewing them, not a record of its own.
_Avoid_: Preview, Mock video, Rough cut, Storyboard

**Clip Mockup Chapter**:
A named divider in an **Animatic** that groups the **Clip Mockups** below it.
_Avoid_: Chapter (unqualified), Animatic Chapter, Section, Group, Divider

**Clip Mockup Comment**:
A note the author pins to a **Clip Mockup** or a **Clip Mockup Chapter**.
_Avoid_: Note, Annotation, Feedback, Review comment

**Script**:
The screenplay-style plan of a **Video**, read off the teleprompter while filming. It is written from the **Clip Mockups**, and the **Transcript** replaces it once the Video is filmed.
_Avoid_: Body, Beat Description, Transcript, Caption

**Section Workbench**:
The authoring view of a single **Section**.
_Avoid_: Section page, Lesson page, Section editor

### Video warnings

**Video Warning**:
An authoring problem on a **Video**, worked out from its clips and chapters.
_Avoid_: Lint warning, Lint error, Danger, Authoring issue

**Missing Chapters**:
The Video Warning raised when a **Video** with Clips has no **Chapter** before its first Clip.
_Avoid_: Missing Opening Chapter, No intro chapter

**Beat Warning** / **Learning Goal Warning**:
Planning reminders: a **Beat** that serves no **Learning Goal**, or a Learning Goal that no Beat serves. They never block a Publish.
_Avoid_: Lint warning, Publish blocker

### Video export and hashing

**Export Hash**:
A fingerprint of everything that decides how a Video is rendered. When it changes, the Video needs a new export.
_Avoid_: Content hash, Video hash

**Short Export Hash**:
The **Export Hash** of a Short, widened to cover its captions.
_Avoid_: Caption hash, Vertical hash

**Exported Video**:
A rendered video file for a Video's current **Export Hash**, checked to be full length.
_Avoid_: Finished video, Output video

**Exported Animatic**:
An **Animatic** rendered to a single video file. It is never published.
_Avoid_: Animatic video, Rendered Animatic

**Unexported Video**:
A **Video** with no **Exported Video** for its current **Export Hash**.
_Avoid_: Dirty video, Stale video

**Purge**:
Deliberately deleting an Exported Video's file, so it becomes an Unexported Video again.
_Avoid_: Clear, Unexport, Delete Exported Videos

**Overlay Render Cache**:
The kept renders of **Overlay** content, so an Overlay isn't rendered again each time its Video is exported.
_Avoid_: Overlay cache, Definition Card cache, Render directory

### Storage

**Storage Root**:
One of the drives CVM keeps its files on. A file can move between Storage Roots without anything else changing.
_Avoid_: Drive, Storage location, Volume

**Storage Bucket**:
A group of files the Storage page counts and moves together, such as one Course's footage, or all **Unused Footage**.
_Avoid_: Block, Group, Folder

**Shared Footage**:
The **Storage Bucket** of **Footage** used by more than one **Course**.
_Avoid_: Common footage, Reused footage

**Unused Footage**:
The **Storage Bucket** of filmed **Footage** that no **Clip** uses. It is the only Footage CVM will delete outright.
_Avoid_: Orphaned footage, Unreferenced footage, Dead footage

**Used Imported Footage**:
The **Storage Bucket** of **Imported Footage** that something uses.

**Unused Imported Footage**:
The **Storage Bucket** of **Imported Footage** that nothing uses. CVM never deletes it.
_Avoid_: Unused Footage

**Delete originals**:
Deleting the files left behind on one **Storage Root** after they were moved to another, once their copies are verified.
_Avoid_: Cleanup, Finish the move, Delete source

### Recording

**Recording Session**:
A period of time, from start to stop, during which clips are captured for one **Video**.
_Avoid_: Session, Take session, Recording

**Recorder**:
What films a **Clip**: CVM's own recorder today, or OBS for older Clips.
_Avoid_: Recording mode, Capture backend, New recorder

**Live Stream**:
The recorder's camera, screen and mic sent live to YouTube while a **Recording Session** runs.
_Avoid_: Stream (alone), Livestream recording, Broadcast

**Streamed Recording Session**:
A **Recording Session** that also feeds a **Live Stream**.
_Avoid_: Stream recording, Live take

**Go Live** / **End Stream**:
Starting and stopping a **Live Stream** together with its **Streamed Recording Session**.
_Avoid_: Start/Stop stream, Stop Stream, Go Offline

**Chat Highlight**:
A live chat message Matt showed on the **Live Stream**.
_Avoid_: Pinned message, Overlay, Callout

**Scene Override**:
A marker on a **Clip** that draws the whole Clip in one scene (Camera, Code or No Face), instead of the scenes that were live while it was filmed.
_Avoid_: Scene change, Layout

**No face** / **Diagram** / **With face** / **Custom**:
The four ways the Article Writer can take a screenshot from a **Clip**: the screen alone, the screen cut to the **Diagram Frame**, the screen with the face, or a hand-drawn crop.
_Avoid_: Scene Override, Hide camera, Screen-only mode, Crop box

**Diagram Frame**:
The part of the recorded screen that diagrams are drawn on, leaving room for the face.
_Avoid_: Safe area, Diagram view, Crop

**AV Calibration**:
A scripted check of Matt's mic level and its sync with the camera. Recording needs a recent one that passed.
_Avoid_: Audio Calibration, Sync calibration, Clap test, Mic check, Level check, Sound check

**Pause**:
A marker on a **Clip** that holds a short pause after it in the edit.
_Avoid_: Beat, Gap, Hold

**Clip Zoom**:
A marker on a **Clip** that shows it slightly zoomed in, for visual variety across camera-only cuts.
_Avoid_: Punch-in, Ken Burns, Scale, Crop

**Suggestion**:
The next line the author could say while recording, shown on the teleprompter.
_Avoid_: Autofill, Prompt

**Steer**:
A short instruction the author gives at an Insertion Point to guide the next **Suggestion** there. A Clip recorded and transcribed at that Insertion Point uses it up; deleting that Clip brings it back.
_Avoid_: Prompt, Hint, Notes, Cue, Direction, Suggestion for the suggestion

**Transcription**:
Getting a **Clip**'s or **Footage**'s text from its audio.
_Avoid_: Caption, Subtitle

**Transcription Status**:
Where a **Clip**'s **Transcription** stands: queued, transcribing, failed or done.
_Avoid_: transcribedAt

### Layers

**Layer**:
One piece of a **Clip**'s picture. A Clip's Layers are drawn bottom to top.
_Avoid_: Track, Stack, Composition, Layout

**Scene Layer**:
The **Layer** that draws a **Clip**'s own recording in its scene layout. A Clip has at most one, at the bottom.
_Avoid_: Base layer, Background, Scene

**Footage Layer**:
A **Layer** that draws a cropped, positioned piece of a **Footage** file over part of a **Clip**.
_Avoid_: B-roll, Cutaway, Picture-in-picture, Inset

### Overlays and transitions

**Overlay**:
A rendered graphic shown on top of a Video's picture, starting at a moment in a **Clip**. Only one is visible at a time.
_Avoid_: Layer, Track, Effect

**Overlay Kind**:
Which content an **Overlay** carries: a **Definition Card**, a **Bullet Panel**, a **Chat Card** or a **Call to Action**.
_Avoid_: Type, Variant, Overlay Type

**Definition Card**:
An **Overlay** that defines a term on screen at the moment it is said.
_Avoid_: Term, Definition, Glossary Entry, Card, Tooltip

**Bullet Panel**:
An **Overlay** with a title and up to four **Bullets**, shown down the left of the frame.
_Avoid_: Bullet List, Side Panel, Callout, List Overlay

**Bullet**:
One line of a **Bullet Panel**, timed to appear as its words are said.
_Avoid_: Item, Point, Row, Line

**Chat Card**:
An **Overlay** on a Short that shows one **Chat Highlight**.
_Avoid_: Chat Overlay, Comment Card, Chat Highlight, Chat Spin

**Call to Action**:
An **Overlay** on a Short: a branded card with a headline and a subline.
_Avoid_: CTA, Advert, Promo, Pill

**Retiming Cascade**:
What recutting a **Clip** does to everything timed from its start, such as its **Overlays** and transcript words.

**Transform**:
An **Overlay**'s pan or zoom on the picture under it. Today it comes only from the **Overlay Kind**.
_Avoid_: Framing, Clip Zoom, Ken Burns, Pan

**Overlay Template** (not yet implemented):
A named, reusable **Overlay** an agent applies to a run of Clips.
_Avoid_: Treatment, Preset, Style

**Transition** (not yet implemented):
A rendered effect at the cut between two **Clips** that replaces footage, rather than sitting on top of it.
_Avoid_: Effect Clip, Bumper, Wipe

### Pitches

**Pitch**:
The packaging for a video (the YouTube, newsletter and tweet copy, plus the thumbnail idea), written before the video is recorded.
_Avoid_: Idea, Concept, Draft

**Pitch State**:
Whether a **Pitch** is Idle, Scheduled or Shipped, worked out from its linked **Deliverables**.
_Avoid_: Pitch Status, Desk State, Pipeline state

**Effort**:
An estimate on a **Pitch** of how much work the video will be: low, medium or high.
_Avoid_: Estimate, Cost, Size, Complexity

### Reference video

**Reference Video**:
Another **Video** on the same **Lesson**, opened beside the one being recorded so the author can read its transcript.
_Avoid_: Previous Take, Reference Take, Source Video

### Diagrams

**Diagram**:
A named drawing whose snapshots change across the **Clips** it appears in.
_Avoid_: Drawing, Sketch, Canvas, Scene

**DiagramSnapshot**:
A copy of a Diagram's drawing at the moment a **Clip** was filmed.
_Avoid_: Frame, Revision, Checkpoint, Version

**Active Diagram**:
The Diagram the author is drawing on now.
_Avoid_: Current diagram, Open diagram

**Preserved Snapshot**:
A **DiagramSnapshot** kept in its Diagram's timeline even when no **Clip** uses it.
_Avoid_: Manual snapshot, Saved snapshot, Bookmark

**Restore to Head**:
Loading an older **DiagramSnapshot** back as the Active Diagram's current drawing, without losing the current one.
_Avoid_: Revert, Roll back, Undo

**Component**:
A named, unchanging piece of a drawing that can be put into any Diagram.
_Avoid_: Template, Stencil, Symbol

**Icon**:
A named glyph on a Diagram.
_Avoid_: Glyph, Symbol, Image

### Lesson body

**Quiz**:
A block of questions in a Lesson's article, answered by the reader on aihero.dev.
_Avoid_: Test, Assessment, Question block, Exercise

**Commit Map**:
The list of commits in the course repo that a lesson uses, at the top of its article.
_Avoid_: Checkpoint, Commit list

### Video destinations

**Skills Changelog**:
A published AI Hero entry for one **Video**: an article plus a newsletter draft.
_Avoid_: Changelog, Skill post, Changelog entry

### Posting Shorts

**Posting Queue**:
CVM's ordered list of Shorts waiting to be posted to YouTube and TikTok. Each entry is Queued, Posting, Posted, Held (the outcome of a post is unknown and waits for the author), Failed or Removed.
_Avoid_: Queue (unqualified), Buffer Queue

**Post Now**:
Sending a Queued Short out at the next opportunity, ahead of the **Posting Slots**.
_Avoid_: Post immediately, Skip the queue

**Posting Slot**:
A time of day when the head of the **Posting Queue** is posted.
_Avoid_: Schedule slot, Time slot

**Slot Schedule**:
The rule that decides how many **Posting Slots** a day gets, and when they are, from the **Posting Queue**'s length at 00:00 UK time. Every day gets at least one (13:00), even when the queue was empty at 00:00; a missed day is not made up.
_Avoid_: Posting schedule, Buffer schedule

### Deliverables and scheduling

**Deliverable**:
An entry on the calendar, fixed to one date. That date is the only deadline in the domain.
_Avoid_: Task, Item, Scheduled work, Ship target

**Deliverable Status**:
Whether a **Deliverable** is planned, done or cancelled, set by hand.
_Avoid_: Completion, Deliverable state

### Dependencies

**Lesson Dependency**:
A link from a **Lesson** to an earlier one it builds on.
_Avoid_: Prerequisite link, Edge

**Order Violation**:
A **Lesson** that depends on a Lesson ordered after it. It is warned about, never prevented.
_Avoid_: Broken dependency, Invalid order

**Dependency Group**:
A run of adjacent Lessons in a **Section**, linked by **Lesson Dependencies**, grouped visually.
_Avoid_: Dependency block, Cluster, Chain, Lesson group

### Remote access

**API Token**:
A credential the author creates so a machine other than theirs can work with the domain data.
_Avoid_: API key, Password, Secret

**Remote Box**:
Any machine that is not the author's, working with the domain data through an **API Token**.
_Avoid_: Server, Agent machine

**Local-only Command**:
A command that needs the author's own machine and refuses to run on a **Remote Box**.
_Avoid_: Offline command, Machine command, Disabled command

### Background work

**Job**:
Work the author starts and walks away from, such as an export, a render, a post or a **Publish**. It keeps going when the browser closes.
_Avoid_: Task, Upload, Background request

**Sidecar**:
The process beside the app that runs **Jobs**.
_Avoid_: Worker, Daemon, Queue
