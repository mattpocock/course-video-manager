import type { writerChatReducer } from "./writer-chat-reducer";

/**
 * The calls Writer Chats make to the Video's writer-chats route. Glue only:
 * what to do with the answer is the reducers' decision. A refused or failed
 * call throws, so the caller can show it.
 */
const failure = (response: Response) =>
  new Error(
    response.status === 409
      ? "This Video is in a Version that is no longer the Draft"
      : `The server answered ${response.status}`
  );

/** Every mode's Writer Chat for one field of a Video. */
export const loadWriterChats = async (
  videoId: string,
  fieldId: string
): Promise<writerChatReducer.Chats> => {
  const response = await fetch(
    `/api/videos/${videoId}/writer-chats?field=${encodeURIComponent(fieldId)}`
  );
  if (!response.ok) throw failure(response);
  const { chats } = (await response.json()) as {
    chats: writerChatReducer.Chats;
  };
  return chats;
};

const post = async (videoId: string, body: object) => {
  const response = await fetch(`/api/videos/${videoId}/writer-chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw failure(response);
};

/** One mode's Writer Chat, replacing what was saved for it. */
export const saveWriterChat = (opts: {
  videoId: string;
  fieldId: string;
  mode: string;
  messages: unknown[];
}) =>
  post(opts.videoId, {
    intent: "save",
    field: opts.fieldId,
    mode: opts.mode,
    messages: opts.messages,
  });

/** Every mode's Writer Chat for a field, set back to `chats`. */
export const restoreWriterChats = (opts: {
  videoId: string;
  fieldId: string;
  chats: writerChatReducer.Chats;
}) =>
  post(opts.videoId, {
    intent: "restore",
    field: opts.fieldId,
    chats: opts.chats,
  });
