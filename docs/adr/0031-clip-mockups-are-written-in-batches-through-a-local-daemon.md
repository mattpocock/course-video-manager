---
status: accepted
---

# Clip Mockups are written in batches, and their frames and speech are made by one local daemon

A **Clip Mockup** costs two slow things: a frame captured from HTML in Chromium, and a line voiced by Kokoro on the author's GPU. Until now `cvm clip-mockup add` made one Clip Mockup per call, and every call was its own process. So every call launched Chromium and loaded Kokoro, and several calls at once each held their own copy of the model.

That was measured when authoring agents began running in parallel (an RTX 4060 with 8 GB, under WSL2):

| Calls at once | Result                  | Adds per minute |
| ------------- | ----------------------- | --------------- |
| 1             | 5.9 s                   | 10              |
| 4             | 9.0 s, 7.8 GB of VRAM   | 27              |
| 8             | 74.5 s, the card full   | 6               |
| 16            | 3 finished in 7 minutes | —               |

Each process held 1–3 GB of VRAM for an 82M-parameter model: the CUDA context, the weights, and onnxruntime's working memory, which it keeps at the largest size a line has needed. Past four processes, WSL paged GPU memory to system RAM and every call slowed about 8×. One call also failed to capture its frame under that pressure. And two calls appending to one **Video** at the same moment read the same last row and computed the same **Fractional Index**, so two rows shared one position.

## Decision

1. **`add` and `update` take a batch, and only a batch.** Their one input is `--clip-mockups-json <file|->`: an ordered array of entries. The file order is the **Animatic** order. An `add` entry may also be a **Clip Mockup Chapter**, because the two nouns share one order space ([ADR 0030](0030-clip-mockup-chapters-share-the-clip-mockup-order-space.md)). The per-moment flags `--say`, `--html` and `--image` are removed. A file with one entry is still valid.
2. **The rows of a batch land in one transaction**, under a `SELECT … FOR UPDATE` lock on the parent Video's row (`lockAnimatic`). The same lock guards every other positioning write: `move`, and the Chapter create and move.
3. **Frames and speech are made by the Clip Mockup daemon**: one process for each checkout, holding one Chromium and one Kokoro model. The first `cvm clip-mockup` call starts it, detached. Every call on the machine sends it work over a Unix socket in `~/.cache/cvm/clip-mockup-daemon/`, and it stops itself after five minutes with nothing to do.
4. **One Kokoro worker.** Lines from every call go through one first-in, first-out queue to one model. Each call's lines form one job, so no call is split around another call's lines.

## Why a batch

- **Only the caller knows the order.** Twenty single appends sent at once land in the order they arrive, even with the race closed. A file carries the teaching order for free.
- **One transaction makes a run all-or-nothing.** A typo in entry 40 is found before anything is captured or voiced. A failed capture leaves no row and no file.
- **It pays the start-up costs once per batch, not once per moment.** One `cvm` process costs ~2.2 s before any work (Node, tsx, the first HTTP round trip), and a cold model costs ~2 s more.

## Why a daemon as well

A batch fixes one agent. It does not fix many agents: the `animatic` skill runs one subagent per Video, so a **Section** can mean 20 subagents at once. With batches alone, each of those is a process with its own model.

- **VRAM is held once.** One process voices 308 lines a minute at ~1.75 GB. Tensor batching was tried and is not possible, because the ONNX export only accepts a batch of 1. Several lines at once in one process gave no gain (~296 lines a minute).
- **A second worker was measured and rejected.** Two worker processes voiced 1.21× as fast (373 lines a minute), and three 1.37× as fast, but each worker costs another 1–3 GB. Three do not fit on the card with 50-word chunks. The author chose one worker.
- **A file lock between batch processes was the smaller alternative.** It would stop the VRAM cliff, but each batch would still load the model again (~20% slower), each waiting process would keep its own Chromium (~20 GB of RAM at 20 subagents), and `flock` does not serve waiters in order.

## Consequences

- **The daemon is NOT a second path to the database.** It never reads or writes a row. It writes PNGs and WAVs to paths that `cvm` gives it, in a scratch directory. `cvm` then copies them into the Clip Mockup directory and writes the rows over the one HTTP transport ([ADR 0025](0025-local-remote-split-one-http-transport.md)).
- **The socket is named by the code.** The daemon's version is a hash of the files it runs, its dependency manifest and the checkout's path. After a merge, the next call starts a fresh daemon on a new socket, and the old one stops after its idle time. Two worktrees never share a daemon. A file that the daemon starts to run must be added to `VERSIONED_FILES` in `protocol.ts`.
- **Two daemons of one version cannot both serve.** A lock file holds the running daemon's pid. A second starter finds a live pid and exits, and a lock left by a crashed daemon is taken over.
- **A call can wait behind another call's batch.** The queue is first come, first served, so an agent must give `add` a longer timeout than a shell's default.
- **Failures keep their names.** A capture failure is still `FrameCaptureError` and a speech failure is still `SpeechSynthesisError` (both exit 4), whether the daemon was warm, had to start, or could not start. A daemon that does not open its socket within 30 s is reported with the path of its log.
- **The tests never start the daemon.** The CLI suites provide `Layer.succeed` fakes of `FrameCaptureService` and `ClipMockupSpeechService`, and the commands use a provided service before they reach for the daemon.
- **The lock is proven only against real Postgres.** PGlite has one connection and runs transactions one after another, so the suite cannot reproduce the race.
