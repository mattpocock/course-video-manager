# Keyboard shortcuts

The detail behind "The Animatic page answers the Video page's keys" in
[`CODING_STANDARDS.md`](../CODING_STANDARDS.md).

The author walks an Animatic with the same habit he walks a filmed Video with,
so the two screens must not disagree about a key. Every shortcut the Video page
has (`features/video-editor/hooks/use-keyboard-shortcuts.ts`) is **ported to the
Animatic page where it has a meaning there**, and it keeps the same meaning:
SPACE plays and pauses where the playhead is, RETURN plays the selected item
from its start, the arrows move the selection and do not touch playback, HOME and
END go to the ends, L and K are 2x and 1x.

One pair differs ON PURPOSE: ARROW LEFT and ARROW RIGHT. On the Video page they
are a second UP and DOWN; on the Animatic they step the PLAYHEAD to the previous
or next Clip Mockup, folded or not, because the author is watching the picture
and a selection does not move it. UP and DOWN keep the Video page's meaning.

On the Animatic page they also WALK OFF THE END of the Video (#2414): RIGHT on
the last Clip Mockup opens the next Video with Clip Mockups from the top,
playing; LEFT in the first second of the first one opens the previous Video at
its last Clip Mockup (past that second it restarts the Clip Mockup). CTRL+LEFT
and CTRL+RIGHT make the same walk by Section. The rules are one pure function,
`features/animatic/animatic-course-walk.ts`; the editor's Animatic overlay
stays inside its one Video.

Port a key only if the Animatic has something for it to act on — the Animatic is
read-only, so DELETE, ALT+ARROW (reorder) and B (pause marker) have no
equivalent and are left out. When a shortcut is ADDED to the Video page, decide
at that moment whether it makes sense on the Animatic page, and add it there too
or say in the code why it cannot be. The two screens also hold the same shape:
the list of moments on the left, the picture on the right.

Both pages share one guard for when a key is not the page's to take —
`app/hooks/should-ignore-keyboard-shortcut.ts`. A new keyboard surface uses it
rather than writing its own test for inputs, Monaco and dialogs.

Global Search's Ctrl/Cmd+K (`features/global-search/global-search-shortcut.ts`,
mounted in the app layout) is the one key that deliberately does NOT use that
guard: it is taken from anywhere under the app layout, inputs and dialogs
included, so the key that opened Global Search always closes it. Holding it down
toggles once (auto-repeats are ignored). Because of it, the Video and Animatic
pages' K and L act only bare: with Ctrl or Cmd held, K is Global Search's and L
is left to the browser (its address bar), never 1x or 2x. Global Search does not
take Ctrl+L.

A surface that lives INSIDE a dialog — the Article Writer preview, whose L and K
step through its ChooseScreenshot placeholders — cannot use that guard whole, so
it uses the guard's `isTypingTarget` half and scopes itself to keys from its own
dialog. The Video and Animatic pages refuse every key from a dialog, so the two
L/K meanings never both act on one press. The writer's bottom bar has keys the
same way (`features/article-writer/writer-shortcuts.ts`): F runs Fix, and
Ctrl+Enter (or Cmd+Enter) does nothing while the model streams, presses Go on an
empty Body, and otherwise runs Apply. Each acts exactly when its button would.

The Video Editor can also open the Animatic player OVER itself: a click on a
Clip Mockup in the side panel's Animatic tab opens it there and plays from that
moment (`features/video-editor/components/animatic-overlay.tsx`). Both
surfaces are then mounted at once, so ONE OWNER of the keyboard lives in the
editor's reducer (`video-state-reducer-animatic.ts`): while `animatic` is set, the
reducer drops every editor shortcut event, and only the Animatic's keys act.
ESC is the Animatic's key there. It closes the player and gives the keys back.
The overlay is a plain overlay and not a `role="dialog"`, because the shared
guard refuses every key from inside a dialog.
