# EMIT STRUCTURED OUTPUT

You have resolved the conflicts and committed the merge. **Do not make any further changes** — only report what you did.

Emit a single block as the last thing in your response:

<output>
{
  "comment": "Markdown body posted as a PR comment. Free-form prose. Describe which conflicts existed, how you resolved each, and flag any uncertainty or remaining problems (e.g. typecheck failures, ambiguous intent). Reference commit SHAs or file paths where useful."
}
</output>

The comment is the only safety net for the human author. Write it like you're handing the branch back to them and want them to be able to spot any bad call you made in 30 seconds.
