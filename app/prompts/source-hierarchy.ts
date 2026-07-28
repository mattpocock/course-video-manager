/**
 * The rules ranking the documents a writing prompt is handed.
 *
 * A video's plan climbs a fidelity ladder — beats → script → transcript — and
 * authority migrates upward: each rung is authored from the one below, then the
 * lower one goes stale. Filming turns the script into the transcript, and from
 * then on the transcript is the truth. These constants put that ladder in front
 * of the model, which otherwise treats every document it is given as equally
 * authoritative.
 */
export const SOURCE_HIERARCHY = `### Source hierarchy

The documents you have been given sit on a three-rung ladder — **beats → script → transcript**. Each rung was authored from the one below it, and the video was filmed from the script. Authority migrates upward: the transcript is what was actually said on camera, so the transcript is the truth.

- **The transcript sets the scope.** It is a ceiling, not a mandate. Never make a claim that was not made on camera — if it is not in the transcript, it was not taught, and it does not belong in your output. Within that boundary, still select ruthlessly: cut tangents, repetition and dead air.
- **The script is the base the presenter improvised from**, not a record of what was said. It is authoritative for spelling and naming only — technical terms, identifiers, file paths, commands, product names — because the transcript is a machine transcription and will garble them. Where the video states a definition loosely, the script's phrasing is a reference for tightening it. Anything present in the script but absent from the transcript was cut while filming: drop it.
- **The transcript is authoritative for leading words** and for vocabulary generally. When a term differs between script and transcript, apply an orthographic test. If the transcript's version is a plausible mis-hearing of the script's — the same sounds, the wrong letters — it is a transcription error, so use the script's spelling. If it is a genuinely different word, the presenter renamed it on camera, so use the transcript's. When in doubt, follow the transcript: it is what the viewer heard.
- **The beats are a stale sketch.** They record the video's intended emphasis — which moves were considered load-bearing — and nothing more. They are not a source of content, scope or ordering. A beat not reflected in the transcript was cut from the video: ignore it.
- **Attached files are supporting material.** They show what was on screen — code, notes, session logs. They supply evidence and detail for claims the transcript already makes, and they are never themselves a source of claims.

Lower rungs may be absent — most videos have no script, and some have no beats. Work with whichever documents you were actually given.`;

export const ARTICLE_SOURCE_HIERARCHY = `${SOURCE_HIERARCHY}

Your output is an annotated transcript, so follow the transcript's order and stay close to it. Your job is to render what was said as readable prose, annotated with the supporting material — not to restructure it.`;

export const PROJECT_SOURCE_HIERARCHY = `${SOURCE_HIERARCHY}

One exception applies here: the git diff defines the steps. The commit is the work the reader is recreating, so every change in the diff earns a step whether or not it was narrated. The transcript still governs the teaching wrapped around those steps — the explanations, the reasoning, and the vocabulary.`;
