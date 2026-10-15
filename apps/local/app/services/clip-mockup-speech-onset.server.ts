import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import { locateClipMockupFile } from "./clip-mockup-files";
import { speechOnsetSeconds } from "./clip-mockup-speech-service";

/**
 * How much of a WAV is read to find where its speech begins: about 1.4 s of
 * 24 kHz mono, four times Kokoro's padding. A line whose speech starts later
 * than that plays from the top.
 */
const HEAD_BYTES = 64 * 1024;

/**
 * Onsets already measured, by file. A speech file is named by a hash of its
 * line, voice and model, so its bytes never change under the same name; the
 * size and mtime are in the key anyway, for the one case that rewrites a file
 * in place (an unreadable WAV re-synthesised over).
 */
const onsets = new Map<string, number>();

/**
 * Where the speech in a Clip Mockup's WAV begins, in seconds — see
 * `speechOnsetSeconds`. Read once per file for the life of the server, and
 * only the head of it, because the Animatic's loader asks for every Clip
 * Mockup of the Video on every poll. `0` for a file it cannot read: the
 * loader already reports a missing WAV as missing.
 */
export const clipMockupSpeechOnsetSeconds = (
  lineageId: string,
  relativePath: string
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const full = yield* locateClipMockupFile(lineageId, relativePath);
    const info = yield* fs.stat(full);
    const mtime = Option.getOrUndefined(info.mtime)?.getTime() ?? 0;
    const key = `${full}\n${String(info.size)}\n${mtime}`;
    const known = onsets.get(key);
    if (known !== undefined) return known;

    const head = yield* Effect.scoped(
      Effect.flatMap(fs.open(full), (file) => file.readAlloc(HEAD_BYTES))
    );
    const onset = Option.match(head, {
      onNone: () => 0,
      onSome: speechOnsetSeconds,
    });
    onsets.set(key, onset);
    return onset;
  }).pipe(Effect.orElseSucceed(() => 0));
