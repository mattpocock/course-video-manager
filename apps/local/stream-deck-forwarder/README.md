# Stream Deck Forwarder

Bridges Stream Deck button presses to the video editor via WebSocket.

## Architecture

- **HTTP server** on port `5174` — receives button presses from Stream Deck
- **WebSocket server** on port `5172` — broadcasts messages to connected video editor clients

It starts only from the main checkout of the repo. In a git worktree `pnpm dev`
prints why and carries on without it, and that worktree's editor is pointed at
a dead address instead of the hub and OBS — see `../live-desk/live-desk.ts`.

## Available Actions

| Action             | HTTP Endpoint                         | Description                                                        |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------ |
| Delete Last Clip   | `GET /api/delete-last-clip`           | Deletes the most recently inserted clip                            |
| Toggle Last Frame  | `GET /api/toggle-last-frame-of-video` | Toggles the last frame overlay                                     |
| Toggle Pause       | `GET /api/toggle-pause`               | Toggles pause at the insertion point                               |
| Add Chapter        | `GET /api/add-chapter`                | Opens the chapter naming modal                                     |
| Clear All Archived | `GET /api/clear-all-archived`         | Clears all deleted clips and orphans across all recording sessions |

### CVM recorder

Passed to the recorder service (`../recorder-service/`), not the hub: the
service acts on whichever Video the recorder is open for, and the editor
follows its events. With no recorder open the press does nothing and the
service says why. OBS Videos keep Elgato's OBS plugin buttons.

| Action          | HTTP Endpoint               | Description                               |
| --------------- | --------------------------- | ----------------------------------------- |
| Start Recording | `GET /api/start-recording`  | Records, with the editor's Silence Length |
| Stop Recording  | `GET /api/stop-recording`   | Stops the recording                       |
| Toggle Record   | `GET /api/toggle-recording` | Stops while recording, records otherwise  |
| Camera scene    | `GET /api/scene-camera`     | Switches to the Camera scene              |
| Code scene      | `GET /api/scene-code`       | Switches to the Code scene                |
| No Face scene   | `GET /api/scene-no-face`    | Switches to the No Face scene             |

### Teleprompter

Consumed only by `/teleprompter`; the Video Editor ignores them.

| Action  | HTTP Endpoint                   | Description           |
| ------- | ------------------------------- | --------------------- |
| Advance | `GET /api/teleprompter-advance` | Move forward one step |
| Back    | `GET /api/teleprompter-back`    | Move back one step    |
| Reset   | `GET /api/teleprompter-reset`   | Return to the top     |

## Stream Deck Setup

1. Start the forwarder (runs automatically with the dev server)
2. In the Stream Deck app, add a **Website** action (or use the **API Ninja** plugin for cleaner setup)
3. Set the URL to `http://localhost:5174/api/<action-name>` (e.g., `http://localhost:5174/api/clear-all-archived`)
4. Assign the button to a key on your Stream Deck

### Example: Clear All Archived Button

1. Add a new button on your Stream Deck
2. Use the **Website** action or **System: Open** action
3. Set URL to: `http://localhost:5174/api/clear-all-archived`
4. This will clear all deleted clips and orphaned clips across every recording session in one press

## Logging

A connect prints the origin of the page and the live client count:

```
Client connected — 2 client(s) — http://localhost:5173
```

If one origin connects three or more times inside ten seconds, the hub says so
once and then collapses the rest:

```
http://localhost:5173 reconnected 3x in under 10s — that page is churning its
hub socket; further connects from it are collapsed (2 client(s))
```

That line means a page reopens its socket on a timer — usually an effect whose
dependencies change on every render. Read it as a pointer to the page named, not
to the hub. See `connection-log.ts`.
