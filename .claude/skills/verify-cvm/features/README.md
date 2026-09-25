# CVM feature map

The maintained list of what a user can do in the Course Video Manager, and how
to drive each one. It is the source of truth for coverage: before you call a
feature verified, check whether this index lists another entry point into the
same behaviour.

Every file answers four questions — what the feature is, how Matt reaches it,
how you drive it with `agent-browser`, and what bites.

| Feature                                                 | Route                           | File                                         |
| ------------------------------------------------------- | ------------------------------- | -------------------------------------------- |
| Course View — sections, lessons, videos, Learning Goals | `/courses/:courseId`            | [course-view.md](course-view.md)             |
| Video Editor — clips, script, beats, overlays           | `/videos/:videoId/edit`         | [video-editor.md](video-editor.md)           |
| Publish — readiness, Autofill, Submit                   | `/courses/:courseId/publish`    | [publish.md](publish.md)                     |
| Videos and Shorts lists                                 | `/videos`, `/shorts`            | [videos-and-shorts.md](videos-and-shorts.md) |
| Pitches                                                 | `/pitches`, `/pitches/:pitchId` | [pitches.md](pitches.md)                     |
| Deliverables Calendar — the home page                   | `/`                             | [deliverables.md](deliverables.md)           |

Not yet mapped, and worth adding the first time you drive one: Diagrams,
Archived Courses, API Tokens, the changelog page, the AI Hero / newsletter /
social / thumbnails tabs of a Video.

Ids that exist in production today, for a read-only drive:

- Course `Cohort 005` — `4cc62b33-db58-455d-83cb-94f680b119e4`
- Course `AI Coding Crash Course` — `50385098-a712-486f-b777-1f76ef31e9e5`

Confirm they still exist rather than trusting this list; read the hrefs off the
sidebar with `agent-browser snapshot -i -u -d 2`.
