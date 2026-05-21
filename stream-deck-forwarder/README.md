# Stream Deck Forwarder

Bridges Stream Deck button presses to the video editor via WebSocket.

## Architecture

- **HTTP server** on port `5174` — receives button presses from Stream Deck
- **WebSocket server** on port `5172` — broadcasts messages to connected video editor clients

## Available Actions

| Action             | HTTP Endpoint                         | Description                                                        |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------ |
| Delete Last Clip   | `GET /api/delete-last-clip`           | Deletes the most recently inserted clip                            |
| Toggle Last Frame  | `GET /api/toggle-last-frame-of-video` | Toggles the last frame overlay                                     |
| Toggle Beat        | `GET /api/toggle-beat`                | Toggles beat/pause at the insertion point                          |
| Add Chapter        | `GET /api/add-chapter`                | Opens the chapter naming modal                                     |
| Clear All Archived | `GET /api/clear-all-archived`         | Clears all deleted clips and orphans across all recording sessions |

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
