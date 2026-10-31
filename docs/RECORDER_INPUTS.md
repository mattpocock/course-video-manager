# Recorder inputs: every losable input says what turns it red

The detail behind the rule in
[`CODING_STANDARDS.md`](../CODING_STANDARDS.md#a-losable-input-says-what-turns-it-red).

This is a judgement rule for the reviewer, because no lint catches it. Any
input that a take or the Live Stream reads can be **dropped**, **cut** or
**frozen**. That covers a camera or mic feed, a screen feed, a card feed, a
socket, a pipe or a device. Watch for these in a diff:

- a dropping fifo;
- `onfail=ignore`;
- `eof_action=repeat|pass`;
- a `listen=1` socket, which accepts only once.

For each such input, the diff must name three things:

- **What turns its health red** when the input is lost. It must be a signal
  about the input itself: its EOF, its freshness, its overflow count, its
  audio. The encoder's fps, dup and drop don't count, because they stay green
  on a frozen picture.
- **How it recovers.** It reconnects, or its process relaunches. Or it says
  plainly that it can't, and stays red until the author acts.
- **The test that proves both,** by cutting or stalling that input.

If an input has none of these, it is a silent single point of failure: block
the PR.

## Why

The first real Live Stream take (#2463) ran about 225 s with a frozen camera
and no sound, and its health line stayed green the whole time:

- The camera writer's feed to the stream overflowed, then hit EOF.
- The stream's `listen=1` socket never accepted the writer's reconnect.
- `eof_action=repeat` held the last camera frame.
- The stream's only audio came through that same feed.

The health line measured only the encoder, so nothing went red.
