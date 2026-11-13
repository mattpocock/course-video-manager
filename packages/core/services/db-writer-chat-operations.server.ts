import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { writerChats } from "../db/schema.js";
import { UnknownDBServiceError } from "./db-service-errors.js";
import { requireDraftVersionForVideo } from "./draft-guard.server.js";
import { type Database } from "./drizzle-service.server.js";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

/** One field's Writer Chats, by mode. */
export type WriterChatsByMode = Record<string, unknown[]>;

/**
 * Writer Chats: the writer's conversation for one field of a Video, in each
 * mode. Spread into VideoOperationsService; the writes are in
 * `writerChatWriteMethods`, so each runs in one transaction with its Draft
 * guard.
 */
export const createWriterChatOps = (db: Database) => {
  const getWriterChats = Effect.fn("getWriterChats")(function* (opts: {
    videoId: string;
    fieldId: string;
  }) {
    const rows = yield* makeDbCall(() =>
      db
        .select({ mode: writerChats.mode, messages: writerChats.messages })
        .from(writerChats)
        .where(
          and(
            eq(writerChats.videoId, opts.videoId),
            eq(writerChats.fieldId, opts.fieldId)
          )
        )
    );
    return Object.fromEntries(
      rows.map((row) => [row.mode, row.messages])
    ) as WriterChatsByMode;
  });

  /** One mode's Writer Chat, replacing what was saved for it. */
  const saveWriterChat = Effect.fn("saveWriterChat")(function* (opts: {
    videoId: string;
    fieldId: string;
    mode: string;
    messages: unknown[];
  }) {
    yield* requireDraftVersionForVideo(db, opts.videoId);
    yield* makeDbCall(() =>
      db
        .insert(writerChats)
        .values(opts)
        .onConflictDoUpdate({
          target: [writerChats.videoId, writerChats.fieldId, writerChats.mode],
          set: { messages: opts.messages, updatedAt: new Date() },
        })
    );
  });

  /** Every mode's Writer Chat for a field, set back to `chats` (a Cancel). */
  const replaceWriterChats = Effect.fn("replaceWriterChats")(function* (opts: {
    videoId: string;
    fieldId: string;
    chats: WriterChatsByMode;
  }) {
    yield* requireDraftVersionForVideo(db, opts.videoId);
    yield* makeDbCall(() =>
      db
        .delete(writerChats)
        .where(
          and(
            eq(writerChats.videoId, opts.videoId),
            eq(writerChats.fieldId, opts.fieldId)
          )
        )
    );
    const rows = Object.entries(opts.chats).map(([mode, messages]) => ({
      videoId: opts.videoId,
      fieldId: opts.fieldId,
      mode,
      messages,
    }));
    if (rows.length > 0) {
      yield* makeDbCall(() => db.insert(writerChats).values(rows));
    }
  });

  return { getWriterChats, saveWriterChat, replaceWriterChats };
};

export const writerChatWriteMethods = [
  "saveWriterChat",
  "replaceWriterChats",
] as const;
