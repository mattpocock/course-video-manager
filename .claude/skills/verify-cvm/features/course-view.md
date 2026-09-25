# Course View

The heart of the app: one Course's Draft Version as a tree of Sections, Lessons
and Videos, with Learning Goals, priorities and to-do state shown inline.

## Sub-features

- **Next Up** — the single card at the top naming the next thing to work on.
- **All Lessons** — the Section/Lesson tree, with search and filters by priority
  (P1/P2/P3), lesson role (Interactive, Discussion, Watch) and Todo count.
- **Display settings** — `Course view display settings`, `Switch to compact
view`, `Collapse all sections`, which change what the tree shows.
- **Learning Goals** — shown in full on a Section card when display settings
  expose them and the Section is not collapsed. Read-only here; editing is the
  `cvm learning-goal` CLI.
- **Inline edits** — priority buttons, the TODO pill, `+ Add description`.
  These WRITE. See the write rules in the skill before pressing one.

## How to get to it (user POV)

Matt clicks the course name in the sidebar rail.

## Driving it with agent-browser

Navigate by URL — the sidebar rail does not respond to a click:

```bash
AB="agent-browser --session verify-cvm"
$AB snapshot -i -u -d 2 | grep -i "<course name>"   # read the href
$AB open http://localhost:5199/courses/<courseId>
$AB wait --load networkidle
```

Confirm you are there with `$AB get title` — it reads `CVM - <course name>`.

Filters and view toggles are plain buttons with accessible names:

```bash
$AB find role button click --name "Todo 56"
$AB find role button click --name "Collapse all sections"
$AB fill "input[placeholder=Search]" "beats"
```

What proves it works: the lesson tree under `All Lessons` changes to match the
filter, and the Todo count in the pill matches the number of lessons shown.

## Gotchas

- **The accessibility tree here is enormous.** Learning Goal descriptions run to
  paragraphs and land in the snapshot whole. Always `-i -c` and cap depth
  (`-d 3`), or scope to the region you care about with `-s`.
- Collapsing all sections first makes the snapshot readable, and is a read-only
  action — it changes display settings, not the Course.
- Several controls carry no accessible name (`button [ref=e5]`). Reach those
  through their parent's text, not by ref alone; refs move on every snapshot.
