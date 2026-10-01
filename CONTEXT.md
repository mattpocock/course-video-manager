# Course Video Manager

A tool for authoring courses as structured collections of sections, lessons, and videos, and for publishing them as immutable releases of finished videos plus a description of the course.

## Language

### Course structure

**Course**:
The primary domain entity: a structured collection of versions, sections, lessons, and videos. It is not backed by any repository on disk (ADR 0018).
_Avoid_: Repo, Project

**Section**:
An ordered group of Lessons within a Course Version. A Section is known by its title, which is unique among its siblings.
_Avoid_: Module, Unit

**Lesson**:
A single learning unit within a Section. A Lesson is known by its title, which is unique among its siblings.
_Avoid_: Exercise, Tutorial, Step

**Learning Goal**:
One thing a learner should come away knowing from a **Section**, written BEFORE the Section's Lessons, Videos and Beats are planned. It has a title, a description and a priority, and is ordered within its Section. It is the first step of the authoring flow: Learning Goals → Lessons, Videos and Beats → Script → recording → article. Every **Beat** in the Section is expected to serve at least one Learning Goal (see **Learning Goal Warning**). The link between the two is set from the Beat side, not from the Learning Goal. Deleting one is an **Archive**, and it removes its links to Beats.
_Avoid_: Objective, Outcome (used loosely elsewhere in course-authoring writing; this is the specific planning-stage entity)

### Course versions

**CourseVersion**:
A snapshot of a course's section, lesson and video structure. Its lifecycle state is always recorded, never inferred: Draft Version → Pending Version → Published Version.
_Avoid_: Version (too vague), Revision

**Draft Version**:
The one CourseVersion that can still change, and the only one that accepts writes to sections, lessons, videos and clips. There is exactly one per course. It has no name or description.
_Avoid_: Current version, Working version

**Has Changes**:
Whether a Draft Version has had any write since it was created, which answers "does this Draft need a **Publish**?" without comparing it to the last **Published Version**. Once set, it stays set for the life of that Draft. The fresh Draft that **Submit** creates starts without it. It has no meaning on a Pending or Published Version.
_Avoid_: Dirty, Modified, Needs publish

**Pending Version**:
A submitted CourseVersion whose release has not yet been confirmed as landed. It is immutable, named and short-lived: it is either Promoted (the release landed) or Discarded (the release failed). There is at most one per course. One that is left over after a crash is resolved the next time the author opens the publish page.
_Avoid_: Frozen version (ambiguous with Published), In-flight version

**Published Version**:
An immutable CourseVersion with a name and description, created by Promoting a Pending Version. It cannot be deleted.
_Avoid_: Released version, Committed version

**Submit**:
The Draft → Pending transition: it gives the release its name and description, marks the Draft as Pending, and creates a fresh Draft from it. It is refused while a Pending Version exists. A write that arrives at the same time either lands before the copy or is refused.
_Avoid_: Freeze (only half the story), Snapshot

**Promote**:
The Pending → Published transition, made once the release is confirmed as landed.
_Avoid_: Finalize, Confirm

**Discard**:
Deletes a Pending Version whose release did not land. It never deletes a Draft or a Published Version. Nothing is lost, because the content lives on in the fresh Draft. A failed release is Discarded automatically.
_Avoid_: Rollback, Delete version

**Publish**:
The release flow: check the Course, **Submit**, render and upload the videos, then **Promote**. Submit comes first so that the release is fixed before any work starts, because a Draft still accepts writes. The Publish renders any **Unexported Video** itself. Every shipping **Video** must be complete: its **Clips** render, and it has a **Body** and a description (ADR 0019). An unfinished Video does not stop a Publish: it decides its Lesson's **Lesson Publish Status**, so the Lesson ships as a **Placeholder Lesson** or is **withheld** (ADR 0029). Only two things stop a release: a Lesson whose Videos make an invalid combination of roles, and a shipping Video with no description. A failed release Discards the Pending Version.
_Avoid_: Commit (that is one phase of it), Deploy, Push

**Bundle**:
What a **Publish** produces: one self-contained, immutable release that holds every shipping Video and a description of the course. Its address is known before any video is rendered, because it comes only from the state of the Course. The same inputs always give the same address, and a Bundle is never changed. A Publish that stops partway can be resumed. The course has one pointer to the Bundle that is current, and it moves only when a new Bundle is complete. Old Bundles are removed by the site that reads them, never by this system (ADR 0023).
_Avoid_: Asset folder, Release folder, Blob pool (deliberately rejected — see ADR 0023)

**Publish Readiness**:
The answer to "what stands between this Course and shipping?" for a **CourseVersion**, given as four lists of outstanding work: **Unexported Videos**, lint warnings (including every **Video Warning**), Lessons with an invalid combination of roles, and incomplete **Videos**. It looks only at the Lessons that ship in full, so it changes with the to-do setting and never with the **Placeholder Floor**. Only three of the four lists stop a release: an **Unexported Video** blocks nothing, because the Publish renders it. So a single "can this ship?" answer must leave the unexported list out. It is different from authoring progress, which counts work no Publish would ship.
_Avoid_: Publish status, Readiness check, Blockers (only three of the four lists block)

**Lesson Publish Status**:
What a **Publish** does with one **Lesson**: it ships (the Lesson and its **Videos** in full), it is a **Placeholder Lesson** (title only), or it is **withheld** (not in the release at all, always with a reason). The answer turns on a **hard gap**, which is a gap the **Autofill** cannot close. There are exactly three: the Lesson has no Video, a Video has no **Clips**, or a Video has no **Body**. A missing description and **Missing Chapters** are not hard gaps, because the Autofill writes both. An **Unexported Video** is not a gap, because the Publish renders it. A Lesson is all or nothing: one hard gap on any of its Videos decides the whole Lesson. Every surface that shows what a Publish will do reads the same answer, so they can never disagree.
_Avoid_: Publish Fate, announced, Lesson state, Effective lesson

**Placeholder Lesson**:
A **Lesson** in a release that has a title and nothing else: no video, no **Body**, no description (ADR 0029). It lets a learner read the name of a Lesson that is not yet filmed, in its real place in the Course, before the Course launches. It keeps the Lesson's identity, so when the Lesson later ships in full it replaces the placeholder rather than appearing twice. A Lesson becomes one when it has a **hard gap** and the **Placeholder Floor** reaches its **Lesson Priority**. It adds no video to the **Bundle**. A **Section** whose Lessons are all Placeholder Lessons still ships; a Section with nothing in it does not.
_Avoid_: Coming Soon Lesson (that is the consumer's rendering choice, not the contract's word), Stub lesson, Ghost Lesson (a different, retired idea), Empty lesson

**Placeholder Floor**:
The lowest **Lesson Priority** whose unfinished Lessons ship as **Placeholder Lessons**: the author's answer to "how far down the Course does this release announce?". It has four positions: announce nothing (the default), P1, P2, P3. Inside the priorities it names, it wins over the to-do setting ("withhold to-do Lessons, except announce the P1s and P2s"), and the two settings work together. It is the author's choice for one Publish and is not recorded on the **Published Version**. It changes which assets ship, so it is part of the **Bundle** address (ADR 0023, ADR 0029).
_Avoid_: Priority cutoff, Announce level, Publish depth, Preview mode

**withheld**:
The **Lesson Publish Status** of a **Lesson** that is not in a release at all. It always gives one of two reasons: the Lesson has a **hard gap** and sits below the **Placeholder Floor**, or the Lesson is finished but the to-do setting holds it back. The reason is the point: a Lesson the author believed was finished must never disappear from a release without a word. Withholding can always be undone and never changes a **Published Version**: move the floor, change the to-do setting, or mark the Lesson done, and publish again.
_Avoid_: Excluded, Skipped, Filtered out, Unpublished

**Autofill**:
A generation pass, with no review step, that writes every missing description and missing **Chapters** for the shipping **Videos** of a **Draft Version** in one go. It is a job of its own and never a stage of a **Publish** (ADR 0024): **Missing Chapters** blocks a Publish, so a stage inside the Publish could never be reached, and a failed generation must never fail a Publish or leave a **Pending Version** behind. It stops when it is done; the author then starts the Publish. Each Video's two fields are written together or not at all, and one Video's failure never stops the others. The same word names the single-Video actions (**Autofill chapters**, **Autofill description**), which keep a preview and a confirm step.
_Avoid_: Generate, Suggest (the former names), Auto-publish, Batch generate

**Autofill Candidate**:
A **Video** the **Autofill** has work for, under the current to-do setting: a shipping Video of the **Draft Version** that has a **Body** and is missing its description, or raises **Missing Chapters** with every **Clip** transcribed, or both. A Video with no Body is never a candidate, because the description is written from it. An existing description is never overwritten, so running the Autofill twice is safe. A Video that is not a candidate is listed with the reason it was skipped.
_Avoid_: Eligible video, Pending video, Autofill target

**Export Version Key**:
A number, set by hand in the code, that is part of every **Export Hash**. Changing it makes every video need a new export.
_Avoid_: Version number, Build version

### Authoring lifecycle

**Lesson Authoring Status**:
A marker on a **Lesson** in each version: todo (the default for a new Lesson) or done. A Published Version keeps the status each Lesson had when it was published. Every Lesson has one. It is different from **Pitch State**. Its changes appear in the **Marked Ready** and **Marked TODO** changelog groups.
_Avoid_: TODO flag, Completion

**Marked Ready** / **Marked TODO**:
The changelog groups for changes to **Lesson Authoring Status** between **Published Versions**: todo → done, and done → todo.
_Avoid_: Completed, Reopened

### Video and clips

**Video**:
A container of clips and chapters that represents a single producible video output.
_Avoid_: Recording

**Standalone Video**:
A Video that belongs to no Lesson, used for reference or temporary content. It is a SEPARATE axis from **Video Format**: a Standalone Video can be **Landscape** or **Short**, and every **Short** is Standalone. Never use "Standalone" to mean a format.
_Avoid_: Orphan video, Unlinked video

**Video Format**:
An axis on every **Video**, with two values: **Landscape** or **Short**. The default is Landscape.

**Landscape**:
The **Video Format** of a horizontal, long-form video. The default.
_Avoid_: Standard (the old value name)

**Short**:
The **Video Format** of a vertical, short-form video (the kind posted to YouTube Shorts, TikTok and similar). "Short" is the name to use everywhere.
_Avoid_: TikTok (reserved for the actual TikTok platform, and NOT the name for a Short)

**Clip**:
A segment of **Footage** within a Video, defined by a start time and an end time in one source file. Deleting a Clip is an **Archive**, but unlike most archived nouns it can be reviewed and restored, so a Clip deleted by mistake can be found again. A Clip is what was FILMED; a **Clip Mockup** is its PRE-IMAGE: the still and the line that stood in for it before filming. Clip Mockups are kept after filming, so the plan can be compared with the Clips really cut.
_Avoid_: Segment, Cut, Take

**Footage**:
A raw source video file (a camera capture, a screen recording) before it is cut into **Clips**: the input to editing, not a product of it. Unlike every other noun here, Footage is not a record: it is known only by where the file is on the author's machine. It is transcribed as a whole file, and a new **Clip** takes its text from that transcript. A Clip points at the Footage it was cut from.
_Avoid_: Raw footage (informal prose ok), Source video

**Effect Clip**:
A special clip for non-speech content (white noise, transitions) put into the timeline by hand. Superseded by **Transition**, which sits at the boundary between two Clips instead of taking a Clip's place; kept until that change ships.
_Avoid_: Filler, Spacer

**Chapter**:
A named divider in a Video's timeline that groups the Clips below it. Maps one to one to YouTube chapters.
_Avoid_: Clip group, Divider, Marker, Section (ambiguous with course Section), Clip Mockup Chapter (a different noun: the **Animatic**'s dividers, which group **Clip Mockups** before filming)

**Video Post**:
A record of a **Video** posted to an external platform: which platform, where, and when. It belongs to the Video.

**Optimistic Clip**:
A clip shown during recording before it is saved.
_Avoid_: Pending clip, Temporary clip

**Clip Web Link**:
A web page that was on screen while a **Clip** was recorded. A Clip can have many. They are shown with the Clip and noted in the **Transcript**, so the writer knows which page went with each moment. Different from the global **Link** list: a Clip Web Link belongs to one Clip and one moment.
_Avoid_: Link (reserved for the global reference-URL list), Clip URL, On-screen link (informal, ok in prose)

**Transcript**:
The ordered text of a **Video**: its **Clips** and **Chapters** together, in timeline order. It is what changelog comparisons are made on. A change to a Chapter (rename, add, delete, reorder) is a Transcript change in the same way that a change to a Clip's text is.
_Avoid_: Clip text (only covers Clips), Joined clips, Caption (reserved for the per-clip transcription product)

**Transcript Word**:
One spoken word of a **Clip**, with the start and end time it was said at. The times are measured from the Clip's own start, not from the Footage and not from the finished Video. A Clip's words are written all at once by a **Transcription** and are never edited one by one. A Clip transcribed before Transcript Words existed has none, which is a normal state; transcribing it again fixes it. Its purpose is to point at an exact spoken moment inside a Clip, which the Transcript cannot do. Recutting the Clip moves its words with it (see **Retiming Cascade**).
_Avoid_: Word timing / Timestamped word (informal, ok in prose), Caption, Subtitle (a rendered product, not this timing data)

**Video File**:
A file attached to a **Video** as **writer context**. It is not a record: the files that are there are the state, and deleting one is permanent. It belongs to the Video, never the Lesson. The Article Writer reads a Video's **Transcript**, **Script**, **Beats**, **Clip Mockup Comments** and Video Files, ranked by the fidelity ladder (see **Script**): only the Transcript decides what the article may claim, and Video Files are supporting material (code samples, notes, session logs) that give detail and evidence, never claims of their own. The one exception is a Clip Mockup Comment about the article itself, which is the author's instruction (see **Clip Mockup Comment**). A duplicated Video or Course gets its own copy of the files; a new Draft Version shares them with the version it came from.
_Avoid_: Attachment, Asset (reserved for exported/published artifacts), Standalone file / Lesson file (the old split, now one concept)

### Video planning

**Beat**:
A single planning unit of a **Video**, classified by its **job** for the viewer (the screenwriting sense of _beat_). A Video's plan is an ordered list of Beats written _before_ recording. A Beat belongs to the **Video**, not the Lesson or Pitch, and can move between Videos. It is deliberately different from a **Chapter**: a Beat is "what I planned to shoot", a Chapter groups "what I shot". There are six kinds: **Definition**, **Walkthrough**, **Playthrough**, **Quest**, **Reaction** (from the Mise en Place glossary), and **Setup**, a production note that is not a job for the viewer and is never published. A Beat can serve several **Learning Goals** of its Video's Section, and is expected to serve at least one whenever its Section has any (see **Beat Warning**). A Beat is the JOB a part of the video does for the viewer; a **Clip Mockup** is the PICTURE and the WORDS. One Beat can become several Clip Mockups, and a Clip Mockup that serves no Beat is legitimate.
_Avoid_: Chapter (the recorded YouTube grouping), Segment (now only the transcript/silence homonym), Section (course Section), Block, Unit

**Beat Description**:
A free-text planning note on a **Beat**: "what I'm actually going to do or say here", separate from its short title. Like the Beat, it is never published.
_Avoid_: Notes, Summary, Body, Caption

**Clip Mockup**:
One still image and one spoken line of a **Video**'s plan: a single moment of the video decided BEFORE filming, with the picture that is on screen and the words said over it. It belongs to the **Video**, beside its **Beats**, and is ordered like a Beat. An authoring agent writes it: it decides what is on screen, makes the picture, and writes the line in the author's voice. Both parts are required, so a moment nobody has decided is visible instead of hidden. A Clip Mockup does NOT point at a **Beat**: one that serves no Beat is useful, because it shows the plan missed a moment. Clip Mockups are written a RUN at a time, never one by one: a run of moments, in the order they play, is added to the end of the Animatic together, and a round of changes to many of them is one write. All of a run lands, or none of it does. It is internal, like the **Beat Description** and the **Script**: it is kept in version snapshots and in a duplicated Video, but never published. It is kept after filming, so the plan can be compared with the **Clips** really cut. Deleting one is an **Archive** and cannot be undone. Clip Mockups are for **Landscape** Videos only.
_Avoid_: Clip (what was filmed — a Clip Mockup is its pre-image), Beat (the job, not the picture), Storyboard (the CVM has no such noun, and the playback is an **Animatic**), Frame (ok in prose for the image alone, never for the record), Mock / Mockup (unqualified), Slide, Shot

**Animatic**:
A **Video**'s ordered **Clip Mockups**, watched as a timed playback or read as lines. The word comes from film, where an animatic is a timed cut of the storyboard with scratch audio, made before the shoot. Watched, each Clip Mockup stays on screen for as long as its line takes to say. Read, it is the Clip Mockup lines one clip at a time, grouped under their **Clip Mockup Chapters**, so the author can film from the Clip Mockups instead of the **Script**. THERE IS NO ANIMATIC RECORD: the word names a way of seeing those Clip Mockups and nothing else. Nothing is stored under this name, and nothing is addressed by it. The author gives notes on it by position ("number 14 is too dense"), or pins a **Clip Mockup Comment** to the moment itself. Its purpose is to see the Lesson from the student's seat before a filming day, when its problems are still cheap to fix. Once the author is happy, the agent writes the Video's **Script** from the Clip Mockup lines.
_Avoid_: Preview (an unqualified word the app uses for other playback), Mock video, Rough cut (an edit of real footage; an Animatic has none), Storyboard (the stills alone, not the timed playback), Animation, Animatic record (there is no such record)

**Clip Mockup Chapter**:
A named divider in a **Video**'s **Animatic** that groups the **Clip Mockups** below it. It has a title and a position and nothing else. It belongs to the **Video**, as a Clip Mockup does, NOT to the Animatic, because THERE IS NO ANIMATIC RECORD. Chapters and Clip Mockups share ONE ORDER, as **Chapters** and **Clips** do, so a divider goes between two moments and nothing else moves (ADR 0030). MEMBERSHIP IS IMPLICIT: a Clip Mockup belongs to the last Chapter above it. So a Chapter can never disagree with the order, and the Clip Mockups above the first divider belong to no Chapter, which is a legitimate state. Deleting a Chapter is an **Archive** and changes nothing else: its Clip Mockups join the Chapter above, or have no Chapter if it was the first. It has NO LINK TO A **BEAT**, and its title must not add one: a title names a broad part of the plan for the author, never a Beat and never a **Learning Goal**. It is for finding your way, like a YouTube chapter, and is internal like a Clip Mockup: kept in version snapshots and in a duplicated Video or Course, never published. It adds no time to the Animatic. Its main use is to fold away runs of Clip Mockups that are already settled, so the moments still being judged sit next to each other; which Chapters are folded is a passing choice of the author, never stored.
_Avoid_: Chapter (unqualified — the filmed timeline's divider over **Clips**; a separate noun with no relation to this one), Animatic Chapter (there is no Animatic record to hold it), Section (ambiguous with course **Section**), Beat (the job, and there is no link to one), Clip Mockup Group / Group / Divider / Marker (say which noun's divider), Act, Storyboard section

**Clip Mockup Comment**:
A note the author pins to exactly one **Clip Mockup** or one **Clip Mockup Chapter**, as a comment is pinned to a passage in a Google Doc. It is a body of text and nothing else: THERE IS NO AUTHOR, because the CVM has no users. A Clip Mockup or a Chapter can have many. It is for the filming day: the teleprompter shows it under the line or divider it hangs off, and an agent reads it before it reviews or rewrites the **Animatic**. It is also for the article: the Article Writer reads every comment under its line or divider. A comment about the article (a point to stress, a correction, a thing to add or leave out) is an instruction, and it is the one source that can take the article past the **Transcript**. A comment about the take is a plan: the Transcript records whether it happened, and it wins on what was said. A comment is never quoted as words said on camera. It belongs to the Video through its parent, and a write goes through the Draft guard like any other noun a Version owns. When its parent is archived it is hidden. Deleting one is a real delete, not an **Archive**. It is internal like its parent: copied into version snapshots and a duplicated Video, never published.
_Avoid_: Note (the Animatic's notes by position are a spoken habit, not this record), Annotation, Feedback, Review comment, Clip Mockup note field (there is no such field)

**Script**:
The high-fidelity, screenplay-style plan of a **Video**: one flowing document per Video (word-for-word prose for definition and framing beats, bracketed cues for improvised playthroughs) read off the teleprompter while filming. It is written from the **Clip Mockups**, one rung above them. THE FIDELITY LADDER: **Beat** (what this part of the video does for the viewer) → **Clip Mockup** (the picture and the words) → **Script** (written out from the Clip Mockup lines) → **Transcript** (what was actually said on camera). Each rung is written from the one below it, and the Transcript, the top rung, supersedes all of them once the Video is filmed. The Script is internal, like the **Beat Description**: kept in version snapshots and in a duplicated Video, but never published. It is different from the **Body** (the published lesson article) and the **Beat Description** (a note on one beat).
_Avoid_: Body (the published article), Beat Description (the per-beat note), Transcript (what was actually said), Caption

**Section Workbench**:
The authoring view of one **Section**, reached from the course view. It shows the same things as the course view, filtered and shown the same way, but for one Section only. Other Sections are not shown.
_Avoid_: Section page, Lesson page (the workbench is section-level; there is no lesson-level page), Section editor

**Course View Display Settings**:
The author's choice of which parts of the course tree are shown on the course view and the **Section Workbench**: **Section** descriptions, **Learning Goals**, **Lesson** details, **Lesson Dependencies**, **Videos**, **Beats** and their details. It lets a phase of work that only needs, say, Learning Goals and Beats hide the rest. Hiding a part also hides the parts inside it. Sections themselves are never hidden. A filter works only on a field that is shown. The setting belongs to the author, not to a Course. It is different from view mode (Compact or Expanded), which decides how a shown field looks, not whether it is shown.
_Avoid_: View mode (that is Compact/Expanded, a different setting)

### Video warnings

**Video Warning**:
A derived authoring problem on a **Video**, calculated from its clips and chapters and never stored. Each warning has a kind (for example **Missing Chapters**). The kinds the **Autofill** clears (missing chapters, missing description) are not shown while authoring, because they are not the author's work, but they still block in **Publish Readiness** (ADR 0024).
_Avoid_: Lint warning, Lint error, Danger (reserved for the per-clip text-similarity signal until it is renamed to a Video Warning kind), Authoring issue

**Missing Chapters**:
The Video Warning raised when a **Video** has at least one **Clip** but no **Chapter** before its first Clip. It follows the YouTube convention that every published video opens with a named chapter. A Video with no Clips does not raise it. It stops a **Publish** and is cleared by the **Autofill**.
_Avoid_: Missing Opening Chapter (the former name), Missing opening section, No intro chapter, Missing 0:00 chapter

**Beat Warning** / **Learning Goal Warning**:
Derived planning problems on a **Beat** and a **Learning Goal**, calculated from a Section's Learning Goals and Beats and never stored. They apply only when the Section has Learning Goals. A Beat Warning is raised on a Beat that serves none of its Section's Learning Goals. A Learning Goal Warning is raised on a Learning Goal that no Beat in the Section serves. Unlike a Video Warning, they are never part of **Publish Readiness**: Beats and Learning Goals are never published, so this is a planning reminder, not something that blocks a release.
_Avoid_: Lint warning, Lint error, Publish blocker (this never blocks a Publish)

### Video export and hashing

**Export Hash**:
A fingerprint of everything that decides how a Video is rendered: its clips and their order and timing, **Pauses**, **Clip Zoom**, **Overlays**, format, and the **Export Version Key**. It decides whether a Video needs a new export, names the **Exported Video**, and is part of the **Bundle** address (ADR 0023). It names what the render was asked to do, not what it produced, so it must include everything that changes the render. Whether a Video is uploaded is decided by the **Byte Hash** instead (ADR 0027).
_Avoid_: Content hash (that is an encoding of the **Byte Hash**, not of this), Video hash, Byte Hash (the recipe and the result are different things)

**Byte Hash**:
The fingerprint of an **Exported Video**'s actual contents: the result, where the **Export Hash** is the recipe. It decides whether a **Video** is sent: a Video whose contents match a file the previous **Bundle** already holds is copied from there, and every other Video is uploaded. The two hashes must never be merged: the Bundle address must be known before any render, and a Byte Hash is known only after it (ADR 0027).
_Avoid_: Content hash (only one of its two encodings), SHA256 (likewise), Export Hash (that addresses the file; this decides the send), File hash, Output hash

**Exported Video**:
A rendered video file, named by its **Export Hash**, whose length has been checked. A file is not enough: an export that is more than a second shorter than its **Clips** is cut short and is refused. The check is recorded with the file, so later Publishes do not repeat it.
_Avoid_: Finished video, Output video

**Unexported Video**:
A **Video** with no **Exported Video** for its current **Export Hash**: either there is no file, or the file is shorter than its **Clips**, or its length was never checked. It blocks publishing only in the sense that the **Publish** renders it.
_Avoid_: Dirty video, Stale video

**Purge**:
Deliberately deleting an Exported Video's file, so that it becomes an Unexported Video again. Undone by exporting again.
_Avoid_: Clear, Delete from file system, Unexport

**Overlay Render Cache**:
The kept renders of **Overlay** content: one render for each distinct piece of content, of any **Overlay Kind**. A render is named by exactly what it draws, plus the **Overlay Renderer Version**. It exists because a Video is exported again whenever any of its **Clips** moves, and rendering every Overlay again each time would be slow. Two Overlays with the same content in the same Course share one render. Everything in it can be made again from the Course, so losing it costs only render time.
_Avoid_: Overlay cache (it holds renders, not **Overlays**), Definition Card cache, Render directory

**Overlay Renderer Version**:
A number, set by hand in the code, that is part of every **Overlay Render Cache** name. Changing it makes every Overlay render again. It is deliberately separate from the **Export Version Key**: a change to how content is drawn should render the content again and leave exported videos alone, and a change to how videos are encoded should do the opposite. A new **Overlay Kind** does not change it.
_Avoid_: Renderer version, Export Version Key (that addresses the export; this addresses the card render)

### Recording

**Recording Session**:
A period of time during which clips are captured, grouping Optimistic Clips before they are saved.
_Avoid_: Session, Take session

**Silence Length**:
A setting of each Recording Session (short or long) for how long a silence must be to end a clip: short (the default) cuts on brief pauses in a sentence, long only on long ones. It is fixed when recording starts.
_Avoid_: Pause Length (former name — reused "Pause", now the clip-level held pause), Silence mode, Silence sensitivity, Pause threshold

**Pause**:
A marker on a **Clip** (none or long) that adds a short held pause after it in the edit. It has values rather than on/off, so more lengths can be added later. Different from **Silence Length** (the recording cut setting).
_Avoid_: Beat (former name), Silence Length, Gap, Hold

**Clip Zoom**:
A marker on a **Clip** (none or subtle) that shows the Clip slightly zoomed in, so a run of camera-only clips has some visual change across its cuts. It is allowed only on Clips recorded from a camera scene. It has values rather than on/off, so more levels can be added later. What the author sees in the editor is what the **Publish** will ship. It is part of the **Export Hash**. Superseded by **Transform**, which can move across Clips; kept until that change ships.
_Avoid_: Punch-in, Ken Burns (implies an animated move; this one is static — reserved as an informal synonym for **Transform** instead), Scale, Crop

**Insertion Point**:
The position in a video timeline where new clips or chapters will be added (start, after a clip, after a chapter, end).
_Avoid_: Cursor, Drop target

**Transcription**:
The process of getting a clip's text from its audio.
_Avoid_: Caption, Subtitle

### Overlays and transitions

**Overlay Template** and **Transition** are **not yet implemented**: they are a design in progress, the planned replacement for today's **Effect Clip** and **Clip Zoom**. Treat those two terms as proposed. **Transform** exists today in one narrow form only (see that entry).

**Overlay**:
A rendered visual layer shown on top of a Video's footage. It starts at a moment inside a specific **Clip**, so moving or trimming earlier Clips carries it along. Its length does not depend on that Clip: it can run on across later Clips, but never past the end of the Video. Different from a **Transition**, which replaces footage at a cut instead of sitting on top of it. It can carry a **Transform**, visible content, or both; its **Overlay Kind** names which content it carries and whether it has a Transform. Each Kind needs its own content. Its **Animation Toggles** control how it enters and leaves. At most one Overlay is visible at any moment in the whole Video: Overlays never overlap, and one that would is refused. Shortening an Overlay is refused if a **Bullet** would no longer fit. An Overlay cannot move to another Video. Deleting one is permanent, because nothing else refers to it. Recutting its Clip moves it with the Clip (see **Retiming Cascade**).
_Avoid_: Layer, Track, Effect

**Overlay Kind**:
Which content an **Overlay** carries: a **Definition Card** (the default) or a **Bullet Panel**. It is part of the **Export Hash**, because it changes what is rendered. The Kind also decides the Overlay's **Transform**: the camera move comes from the Kind and is never written separately, so a Bullet Panel always gets its panel and its camera move together.
_Avoid_: Type, Variant, Overlay Type

**Definition Card**:
An **Overlay**'s visible content: a small, AI Hero branded card on screen that defines a term at the moment it is said. It has exactly a title (the term) and a description (the definition). It is written on the Overlay itself: there is no shared glossary to pick a definition from, so two Overlays that define the same term each have their own copy. The default **Overlay Kind**.
_Avoid_: Term, Definition, Glossary Entry, Card (reserved for an eventual family of card-shaped content-kinds), Tooltip

**Bullet Panel**:
An **Overlay**'s visible content, and the second **Overlay Kind**: a title plus at most four **Bullets**, shown as a list down the LEFT of the frame. The side is always the left, because its camera move clears room on that side only. Four is the limit so the panel stays readable, and a fifth Bullet is refused. The panel's dark background covers only its own column, so the presenter is never darkened. A Bullet Panel has no description.
_Avoid_: Bullet List, Side Panel, Callout, List Overlay

**Bullet**:
One line of a **Bullet Panel**: an icon, its text, and the time it appears, measured from the Overlay's own start. The time is set for each Bullet so that it can appear exactly as its words are said. Bullets must appear in the order they are read, and no two at the same moment, because a staggered reveal is the point. Each Bullet must have time to appear fully before the panel starts to leave. Each Bullet appears on its own, except one that appears at the very start, which arrives with the panel. The panel leaves all at once.
_Avoid_: Item, Point, Row, Line

**Animation Toggles**:
Two settings on an **Overlay**: no enter animation and no exit animation. Each turns one end of the Overlay into a hard cut. The change still happens at the same moment, so turning one off does not move any **Bullet**. They are on the Overlay, not on its content, because they control the content and the camera move TOGETHER, so the two can never get out of step. They are part of the **Export Hash**.
_Avoid_: Instant, No-animate, Hard cut (the effect, not the field)

**Retiming Cascade**:
What recutting a **Clip** does to everything placed relative to that Clip's start. Moving the Clip's start moves the footage under every stored time, so each **Transcript Word** and each **Overlay** on the Clip moves by the same amount, at the same time as the recut. They differ on what happens to one pushed outside the Clip's new range, and the reason is whether it can be recovered. A Transcript Word can be made again by transcribing, so one outside the range is DROPPED. An Overlay holds content the author wrote, which nothing can make again, so it is moved back inside the range and never deleted. An Overlay in the wrong place is a visible problem that can be fixed; a deleted one is just gone.

**Overlay Template** (not yet implemented):
A named, reusable Overlay (or small group of them) that an agent picks and applies to a run of Clips, rather than designing one from scratch each time. It would own its own **Transform**, if any. Today a Transform comes from the **Overlay Kind** instead.
_Avoid_: Treatment, Preset, Style

**Transition** (not yet implemented):
A rendered effect at the boundary between two **Clips** that replaces footage at the cut, instead of sitting on top of footage like an **Overlay**. Supersedes the transition use of **Effect Clip**.
_Avoid_: Effect Clip (see that entry), Bumper, Wipe (a specific Transition style, not the category)

**Transform**:
An **Overlay**'s pan or zoom move on the footage under it: a sequence of framings, moved through in order across the Overlay's length. It does not depend on the Overlay's content: it can move the frame with nothing on top, or make room for a card or panel. Supersedes **Clip Zoom**, which was a single fixed zoom that could not cross Clips. Until that change happens, the two cannot be used together: an Overlay over a Clip with a Clip Zoom is refused.

What exists today is the narrowest form: not a sequence the author writes, but a fixed move that comes from the **Overlay Kind**. A Definition Card has none. A Bullet Panel slides the footage to the right by the panel's width, to clear the left of the frame for the panel. It is a SLIDE, never a zoom. It eases in and back out, unless the **Animation Toggles** make that end a cut. The panel and the footage move at one speed, because they are one move seen twice.
_Avoid_: Framing, Clip Zoom (see that entry), Ken Burns, Pan

### Pitches

**Pitch**:
A reusable packaging artifact — the YouTube, newsletter and tweet copy and the thumbnail idea for a video — written _before_ the video is recorded. A Pitch is outside the Course structure; it relates only to **Standalone Videos**.
_Avoid_: Idea, Concept, Draft (overloaded with Draft Version)

**Pitch State**:
A Pitch's state, derived (never stored) from the **Deliverable Status** of its linked **Deliverables**: **Idle** (none linked), **Scheduled** (some linked, not all finished), **Shipped** (all done or cancelled). Giving up on a Pitch is separate: a Pitch is hidden by **Archive**, not by Pitch State.
_Avoid_: Pitch Status (no stored status field), Desk State, Pipeline state

**Effort**:
An estimate on a **Pitch** of how much work the video will be: low, medium (the default) or high. It is on the Pitch because it is used to choose work _before_ the video exists. Within one priority, low effort comes first ("low-hanging fruit"); effort never overrides priority.
_Avoid_: Estimate, Cost, Size, Complexity

**Default Pitch Filter**:
The pitch list shows **Idle** and **Scheduled** Pitches by default; the author can choose to show **Shipped** ones as well.

### Reference video

**Reference Video**:
Another **Video** on the same **Lesson**, opened beside the one being recorded so the author can read its **Clip** transcripts (grouped by **Chapter**) while recording again. It is not stored as a link: any other Video on the Lesson can be one. The author chooses it each time; it is never chosen automatically.
_Avoid_: Previous Take (implies take-history we don't model), Reference Take, Source Video

### Diagrams

**Diagram**:
A named, lasting identity: the "home" for a series of snapshots that change across the **Clips** it appears in. It is outside the Course structure; any **Video** can use it.
_Avoid_: Drawing, Sketch, Canvas, Scene (reserved for the drawing tool's own term)

**DiagramSnapshot**:
An immutable copy of a Diagram's drawing at the moment a specific **Clip** was filmed. It is pinned to that Clip, so going back to the Clip later shows the diagram as it was filmed, even after the Diagram has changed.
_Avoid_: Frame, Revision, Checkpoint, Version (overloaded with **CourseVersion**)

**Active Diagram**:
The Diagram the author is drawing on now. There may be none, in which case the author is on **Playground Home**. It stays the same across **Clips** until the author changes it.
_Avoid_: Current diagram, Open diagram

**Playground Home**:
The place to browse Diagrams and create new ones, shown when there is no **Active Diagram**.
_Avoid_: Diagram picker, Diagrams page

**Preserved Snapshot**:
A **DiagramSnapshot** marked to stay in its Diagram's timeline even when no **Clip** pins it. The author can preserve one by hand, and one is made automatically when a **Restore to Head** would otherwise lose unsaved work. A snapshot that is not preserved disappears when all its Clips are archived; a Preserved one does not. Preserved and pinned are two separate reasons to keep a snapshot.
_Avoid_: Manual snapshot, Saved snapshot, Standalone snapshot, Bookmark

**Restore to Head**:
Loading an older **DiagramSnapshot** back as the Active Diagram's current drawing. If the current drawing is not held by any snapshot, it is either preserved first or the author is asked to confirm, so nothing is lost without warning. If the current drawing is already held by a snapshot, the restore happens without asking. It does nothing if the drawing already matches the snapshot.
_Avoid_: Revert, Roll back, Undo

**Snapshot Step**:
Moving one place along the Active Diagram's timeline, older or newer, with a **Restore to Head** on the snapshot it lands on. The position is read from the current drawing, not stored. Snapshots with identical content count as one place, and a step always changes the drawing. The timeline is a ring: stepping past one end comes back at the other.
_Avoid_: Undo/redo (this walks the timeline, not the drawing tool's history), Prev/next snapshot, Scrub

**Component**:
A named, immutable piece of a drawing, saved from a selection and able to be put into any Diagram. It has no history and no relationship to any Diagram: saving one copies the shapes out, so the Diagram it came from can change or be deleted without affecting it. It can only be renamed or deleted; deleting is permanent.
_Avoid_: template, stencil, symbol, DiagramComponent (there is no such record on a Diagram), "saved selection"

**Command Palette**:
The single keyboard way, inside the **Active Diagram**, to insert an **Icon** or a **Component**, replace an Icon, save a selection as a Component, search all Diagrams by content, and reach the snapshot and diagram actions (ADR 0004). It exists only with an Active Diagram, never on **Playground Home**.
_Avoid_: Command bar, Quick actions, Spotlight, Omnibox

**Icon**:
A named glyph on a Diagram. It stores only the icon's **name**, never its shape, and the set of icons only ever grows, so a Diagram shows its icons exactly as they were when it was filmed. An Icon's name is found by content search.
_Avoid_: Glyph, Symbol, Image (icons are deliberately not assets — ADR 0003)

**Replace Icon**:
Pointing an **Icon** already on a Diagram at a different glyph. Only the name changes, so its size, position, style and connections all stay: that is the difference from adding a new Icon and deleting the old one. It is possible only when exactly one Icon is selected.
_Avoid_: Swap icon, Change icon, Edit icon (an Icon has no edit mode)

### Lesson body

**Quiz**:
A block of questions in a **Video**'s **Body**, answered by the reader on aihero.dev. It is kept word for word in the form AI Hero expects, and a **Publish** ships it unchanged. The CVM only shows it, cuts single questions out of it, and checks it. Every question has an id unique across the **Course**, because reader answers are recorded against the id, not the question text. The Article Writer writes one when writing an article.
_Avoid_: Test, Assessment, Question block, Exercise (reserved for the course's practical work)

**Commit Map**:
The list of commits a lesson uses, at the top of a **Video**'s **Body**. Each entry names a lesson commit in the course project repo, which the CVM never reads; `main` is the one entry that is not a lesson commit. The first entry is where a reader starts the lesson. It can also name the course repo's package manager. Like a **Quiz**, it is kept word for word and shipped unchanged. It is written by hand; the Article Writer writes one only when asked.
_Avoid_: Checkpoint, Commit list, Course Version commit state (release state, unrelated). "Reset point" names what the first entry is _for_, never an entry in general — a later entry is a cherry-pick target too.

### Video destinations

**Skills Changelog**:
A published AI Hero entry that bundles an article and a newsletter draft for one **Video**. It is published at once and creates a newsletter draft, which is never sent automatically. The newsletter is required. Its public page links back to the skills page.
_Avoid_: Changelog (ambiguous with course publish changelog), Skill post, Changelog entry

### Deliverables and scheduling

**Deliverable**:
An entry the author writes on the **Deliverables Calendar**, fixed to one date. That date is the only deadline in the domain. It can link to any number of **Courses** and **Pitches**. A Deliverable's own state is never derived, but a linked Pitch's **Pitch State** is derived from it. An archived Deliverable is hidden everywhere; archiving is the only way to hide one.
_Avoid_: Task, Item, Scheduled work, Ship target

**Deliverable Status**:
A marker on a **Deliverable**: planned (the default), done, or cancelled. Every change can be undone, and it is never derived from linked entities. "Manual" means _not derived_: the author and an agent set it the same way (ADR 0022). Different from **Archive**: a cancelled Deliverable stays on the calendar; archiving is what hides it.
_Avoid_: Completion, Deliverable state

**Deliverables Calendar**:
The view of all **Deliverables** across past and future dates, used for planning ahead and for looking back.
_Avoid_: Delivery calendar, Schedule, Roadmap, Content calendar

**ISO Week**:
ISO 8601 week numbering (weeks start on Monday; week 1 contains the year's first Thursday). Shown as "Week N".
_Avoid_: Calendar week, Week number (without "ISO" qualifier)

### Ordering and lifecycle

**Fractional Index**:
An ordering value that lets an item go between two others without renumbering the rest.
_Avoid_: Sort order, Position

**Archive**:
Soft deletion: hiding an entity from active views while keeping it. What can be done after depends on the noun. For most (Beat, Clip Mockup, Chapter, Learning Goal, Section, Lesson) it cannot be undone. Archived Courses and Videos can be listed but not restored. A **Clip** is the one noun that can be both reviewed and restored, so a Clip deleted by mistake can be found and brought back.
_Avoid_: Delete, Remove

**ARCHIVE Section**:
A Section whose name ends in `ARCHIVE`, hidden from the default course view.

### Dependencies

**Lesson Dependency**:
A link from one **Lesson** to an earlier one it builds on. It points backward (a Lesson depends on prerequisites above it); a dependency on a _later_ Lesson is an **Order Violation**, which is warned about but allowed. Circular dependencies are refused.
_Avoid_: Prerequisite link, Edge (unqualified)

**Order Violation**:
A saved state where a **Lesson** depends on a Lesson ordered _after_ it (in the same Section or a later one). It is shown as a warning but never prevented, so it can exist in saved work.
_Avoid_: Broken dependency, Invalid order

**Dependency Group**:
The longest run of lessons next to each other in one **Section**, in display order, linked by **Lesson Dependencies**: going from top to bottom, a Lesson joins the group only if it depends directly on a Lesson already in it. Dependencies that skip over lessons or point forward are not part of it. It is only a visual grouping, different from a **Section**.
_Avoid_: Dependency block, Cluster, Chain, Lesson group

### Remote access

**API Token**:
A credential the author creates so that a machine other than theirs can work with the domain data. It has a **name** (which machine it is on), an **expiry**, and can be **revoked** at any moment; its **last used** time makes a forgotten token easy to find. The secret is shown only once, when it is created. In this first version a token allows every operation.
_Avoid_: API key, Password, Secret (unqualified)

**Remote Box**:
Any machine that is not the author's, working with the domain data through an **API Token**. It can reach every domain noun — Course, Course Version, Section, Lesson, Video, Clip, Beat, Pitch, Deliverable — so it can find work, write a **Script** and a **Body**, plan **Beats**, draft **Pitches**, change the **Draft Version** and keep the **Deliverables Calendar**. It can never do anything that needs the author's own machine: the finished videos, Video Files, Clip Mockup images, Footage, rendering, or recording.
_Avoid_: Server, Agent machine

**Local-only Command**:
A command that needs the author's own **machine** rather than only the domain data, and so can never run on a **Remote Box**: working with Video Files, Footage, Clip Mockups, Publish Readiness, and Publish. It refuses before doing any work and says what it needed. Refusing first means an agent stops rather than retrying, and a **Course** is never left half-changed. A machine is treated as remote unless it says it is the author's.
_Avoid_: Offline command, Machine command, Disabled command

**Schema Version**:
The version of the data structure a copy of the tool was built for, compared on every request with the version the shared service runs. Any difference is refused, with both numbers and a request to update, so an out-of-date machine can never write data it does not understand. Changes to the data structure only add, so a machine already working when one arrives keeps working.
_Avoid_: API version, Migration number, Protocol version
