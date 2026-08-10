/**
 * What the Article Writer knows about commit maps.
 *
 * The syntax here is one of two live copies — the other is the
 * `commit-maps.md` reference in the `creating-content` skill, which holds the
 * same contract for agents drafting outside this app. Change both.
 *
 * Note the shape of this prompt: the restraint comes first. The writer must
 * recognise a commit map and be able to author one correctly on request, and
 * must never volunteer one — only the person editing the course repo knows
 * which commits a lesson has.
 */

export const COMMIT_MAP_INSTRUCTIONS = `
## Commit Maps

Some lessons open with a commit map: the list of commits in the course project repo that the lesson uses.

**Never write one unless you are asked to.** You cannot know which commits a lesson has — that lives in the course repo, which you cannot see. If a lesson has no commit map, leave it that way. If a lesson already has one, leave it alone: do not reword its descriptions, reorder its entries, or move it.

When you are asked for one, this is the shape:

<CommitMap>
  <Commit id="analytics-tickets">Start the lesson — the PRD turned into multi-phase tickets</Commit>
  <Commit id="implement-skill">See my solution — the \`/implement\` skill added</Commit>
</CommitMap>

The rules:

- It goes at the **top of the body**, before the first line of prose. It is navigation: the reader needs it before they start, not after.
- Each \`id\` is a **slug** — the id of a commit in the course project repo, in kebab-case. It names what the commit does to the tree (\`add-settings-json\`), not the lesson it appears in. Never invent a slug. Use the ones you are given.
- \`main\` is the one legal id that is not a slug. It names the course's starting point, the state a student first clones.
- The **first entry is the reset point** — where a student goes to start the lesson. Later entries are the other points the lesson mentions, in the order the lesson reaches them.
- Each description says what the reader gets by going there, in the lesson's own terms — "Start the lesson — …", "See my solution — …". It is not the commit's message. Markdown works inside it; backticks for file and skill names.
- **No blank lines anywhere inside the block.** The opening tag, every \`<Commit>\`, and the closing tag sit on consecutive lines. A blank line changes how the page parses, and an unclosed \`<CommitMap>\` breaks the entire lesson body.
- Each commit appears once. A \`<Commit>\` outside a \`<CommitMap>\` means nothing.
`.trim();
