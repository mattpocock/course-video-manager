/**
 * Long-form --help text for `cvm chat-highlight`, split out of
 * chat-highlight.ts as every noun's help is.
 */
export const HELP = `chat-highlight — a Broadcast chat message shown on the Live Stream picture.

A Chat Highlight is a chat message the author showed on the Live Stream by
clicking it: clicking it again hides it, and clicking another replaces it, so
at most one shows. It belongs to its Streamed Recording Session, and stores the
author and text as shown, and when the card went on and off the picture. It is
not an Overlay; a Chat Card is made from one on request ('cvm overlay add
--kind chatCard --chat-highlight <id>').

READ-ONLY. Not local-only.

Verbs:
  chat-highlight list (--recording-session <id> | --video <id>)
      the Chat Highlights, in shown order (NDJSON)`;

export const LIST_HELP = `The Chat Highlights of a Streamed Recording Session, in shown order.

  cvm chat-highlight list --recording-session <id>
  cvm chat-highlight list --video <id>

Exactly one of the two. --video lists those of every Recording Session the
Video's Clips come from (a Short cut from a Live Stream lists the stream's),
session by session in Clip order.

Prints NDJSON, one line per Chat Highlight:
  { id, recordingSessionId, shownAt, hiddenAt, author, text }
'shownAt' and 'hiddenAt' are seconds on the Recording Session's clock (file
time: the clock of 'short create --recording-session --range' and of a
Clip's source times); 'hiddenAt' is null while it is still showing. A Chat
Card added by time shows the one showing at its anchor point: the latest
shown by then, if not yet hidden.

An unknown Recording Session or Video is not-found (exit 2); one with no
Chat Highlights prints nothing.`;
