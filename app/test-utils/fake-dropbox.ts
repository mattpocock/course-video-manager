import { vi } from "vitest";
import { computeDropboxContentHash } from "@/services/dropbox-content-hash";

type StoredFile = {
  content: Buffer;
  contentHash: string;
  pathDisplay: string;
};

export const FAKE_ACCESS_TOKEN = "fake-dropbox-access-token";

export const createFakeDropbox = () => {
  const files = new Map<string, StoredFile>();
  const sessions = new Map<string, { chunks: Buffer[] }>();
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  let sessionCounter = 0;

  const store = (pathDisplay: string, content: Buffer) => {
    const key = pathDisplay.toLowerCase();
    files.set(key, {
      content,
      contentHash: computeDropboxContentHash(content),
      pathDisplay,
    });
  };

  const get = (path: string): StoredFile | undefined =>
    files.get(path.toLowerCase());

  const fileMetadata = (stored: StoredFile) => ({
    ".tag": "file" as const,
    name: stored.pathDisplay.split("/").pop()!,
    path_display: stored.pathDisplay,
    size: stored.content.length,
    content_hash: stored.contentHash,
  });

  const bodyToBuffer = async (
    body: BodyInit | null | undefined
  ): Promise<Buffer> => {
    if (body == null) return Buffer.alloc(0);
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (body instanceof ArrayBuffer) return Buffer.from(body);
    if (typeof body === "string") return Buffer.from(body);
    return Buffer.from(await new Response(body).arrayBuffer());
  };

  const getApiArg = (headers: HeadersInit | undefined): any => {
    const raw = (headers as Record<string, string> | undefined)?.[
      "Dropbox-API-Arg"
    ];
    return raw ? JSON.parse(raw) : {};
  };

  const handleFetch = async (
    url: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const urlStr =
      typeof url === "string"
        ? url
        : url instanceof URL
          ? url.toString()
          : url.url;
    const reqInit = init ?? {};
    fetchCalls.push({ url: urlStr, init: reqInit });

    // Upload
    if (urlStr.includes("/2/files/upload") && !urlStr.includes("session")) {
      const apiArg = getApiArg(reqInit.headers);
      const content = await bodyToBuffer(reqInit.body);
      store(apiArg.path, content);
      return new Response(JSON.stringify(fileMetadata(get(apiArg.path)!)));
    }

    // Upload session start
    if (urlStr.includes("/2/files/upload_session/start")) {
      const id = `session-${++sessionCounter}`;
      const content = await bodyToBuffer(reqInit.body);
      sessions.set(id, { chunks: [content] });
      return new Response(JSON.stringify({ session_id: id }));
    }

    // Upload session append
    if (urlStr.includes("/2/files/upload_session/append_v2")) {
      const apiArg = getApiArg(reqInit.headers);
      const session = sessions.get(apiArg.cursor.session_id);
      if (!session) {
        return new Response(JSON.stringify({ error: "session not found" }), {
          status: 409,
        });
      }
      const content = await bodyToBuffer(reqInit.body);
      session.chunks.push(content);
      return new Response(null, { status: 200 });
    }

    // Upload session finish
    if (urlStr.includes("/2/files/upload_session/finish")) {
      const apiArg = getApiArg(reqInit.headers);
      const session = sessions.get(apiArg.cursor.session_id);
      if (!session) {
        return new Response(JSON.stringify({ error: "session not found" }), {
          status: 409,
        });
      }
      const lastChunk = await bodyToBuffer(reqInit.body);
      if (lastChunk.length > 0) session.chunks.push(lastChunk);
      const fullContent = Buffer.concat(session.chunks);
      sessions.delete(apiArg.cursor.session_id);
      store(apiArg.commit.path, fullContent);
      return new Response(
        JSON.stringify(fileMetadata(get(apiArg.commit.path)!))
      );
    }

    // Download
    if (urlStr.includes("/2/files/download")) {
      const apiArg = getApiArg(reqInit.headers);
      const stored = get(apiArg.path);
      if (!stored) {
        return new Response(
          JSON.stringify({
            error_summary: "path/not_found/..",
            error: { ".tag": "path", path: { ".tag": "not_found" } },
          }),
          { status: 409 }
        );
      }
      return new Response(new Uint8Array(stored.content), {
        headers: {
          "Dropbox-API-Result": JSON.stringify(fileMetadata(stored)),
        },
      });
    }

    // Get metadata
    if (urlStr.includes("/2/files/get_metadata")) {
      const body = JSON.parse(reqInit.body as string);
      const stored = get(body.path);
      if (!stored) {
        // Check if it's a folder
        const prefix = body.path.toLowerCase() + "/";
        const isFolder = Array.from(files.keys()).some((k) =>
          k.startsWith(prefix)
        );
        if (isFolder) {
          return new Response(
            JSON.stringify({
              ".tag": "folder",
              name: body.path.split("/").pop(),
              path_display: body.path,
            })
          );
        }
        return new Response(
          JSON.stringify({
            error_summary: "path/not_found/..",
            error: { ".tag": "path", path: { ".tag": "not_found" } },
          }),
          { status: 409 }
        );
      }
      return new Response(JSON.stringify(fileMetadata(stored)));
    }

    // List folder
    if (
      urlStr.includes("/2/files/list_folder") &&
      !urlStr.includes("continue")
    ) {
      const body = JSON.parse(reqInit.body as string);
      const prefix = body.path.toLowerCase();
      const entries: any[] = [];
      const seenFolders = new Set<string>();

      for (const [key, stored] of files) {
        if (!key.startsWith(prefix + "/")) continue;
        entries.push(fileMetadata(stored));
        // Add parent folder entries if recursive
        if (body.recursive) {
          const rel = stored.pathDisplay.slice(body.path.length + 1);
          const parts = rel.split("/");
          for (let i = 1; i < parts.length; i++) {
            const folderPath = body.path + "/" + parts.slice(0, i).join("/");
            if (!seenFolders.has(folderPath.toLowerCase())) {
              seenFolders.add(folderPath.toLowerCase());
              entries.push({
                ".tag": "folder",
                name: parts[i - 1],
                path_display: folderPath,
              });
            }
          }
        }
      }

      return new Response(
        JSON.stringify({ entries, has_more: false, cursor: "fake-cursor" })
      );
    }

    // Fallback
    return new Response(JSON.stringify({ error: "unhandled" }), {
      status: 500,
    });
  };

  const install = () => {
    vi.stubGlobal("fetch", vi.fn(handleFetch));
  };

  const cleanup = () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  };

  return {
    files,
    fetchCalls,
    get,
    store,
    install,
    cleanup,
    handleFetch,
  };
};
