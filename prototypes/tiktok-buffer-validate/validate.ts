/**
 * THROWAWAY prototype — CVM wayfinder ticket #1278.
 *
 * Question this answers (HITL, on Matt's real accounts):
 *   1. Caption — does the caption ride as the top-level `text` field on the
 *      `createPost` mutation (not a Dropbox sidecar .txt) and land on the
 *      TikTok post verbatim?
 *   2. Publish mode — does the post AUTO-PUBLISH or fall back to REMINDER mode?
 *      Buffer models this with `schedulingType: automatic | notification`, and
 *      Direct/auto-post to TikTok requires *original audio*. This script asks
 *      for `automatic` by default; observe whether TikTok actually auto-posts
 *      or Buffer downgrades it to a reminder. `--scheduling notification`
 *      requests reminder mode explicitly for comparison. `mode` (shareNow vs
 *      addToQueue) is the separate now-vs-queue lever.
 *
 * Transport under test (locked in #1277):
 *   render/pick .mp4  ->  upload to Vercel Blob (public URL)
 *                     ->  Buffer GraphQL createPost(assets:[{ video:{ url } }], text: caption)
 *                     ->  poll post(id).status until sent / error
 *                     ->  blob is safe to delete once status == sent
 *
 * Secrets come ONLY from env — never hardcode, never print them:
 *   BUFFER_API_KEY          personal API key (Buffer Settings -> API)
 *   BLOB_READ_WRITE_TOKEN   Vercel Blob RW token
 *
 * API shapes verified against developers.buffer.com (mid-2026, post-2026-05-25
 * breaking `assets` change). Not production. Do not merge to main. See README.md.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { put, del } from "@vercel/blob";

// ---------------------------------------------------------------------------
// Config / secrets (env only)
// ---------------------------------------------------------------------------

// Buffer's GraphQL endpoint is the ROOT (POST https://api.buffer.com), not /graphql.
const BUFFER_API = "https://api.buffer.com";
const BUFFER_API_KEY = requireEnv("BUFFER_API_KEY");
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN; // @vercel/blob also reads this implicitly

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(
      `\n  Missing env var: ${name}\n  (set it in your shell; never commit it)\n`
    );
    process.exit(1);
  }
  return v;
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set([
  "--channel",
  "--org",
  "--scheduling",
  "--poll-minutes",
]);
const isFlag = (a: string) => a.startsWith("--");
const flags = new Set(argv.filter(isFlag));

function flagValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
// positionals = args that are neither a flag nor a value-flag's value
const cleanPositionals = argv.filter(
  (a, i) => !isFlag(a) && !(i > 0 && VALUE_FLAGS.has(argv[i - 1] ?? ""))
);

const LIST_CHANNELS = flags.has("--list-channels");
const SHARE_NOW = flags.has("--share-now"); // mode: shareNow, else addToQueue
const KEEP_BLOB = flags.has("--keep-blob"); // don't auto-delete even on sent
const CHANNEL_ID = flagValue("--channel");
const ORG_ID = flagValue("--org");
const SCHEDULING = (flagValue("--scheduling") ?? "automatic") as
  | "automatic"
  | "notification";
const POLL_MINUTES = Number(flagValue("--poll-minutes") ?? "20");

// ---------------------------------------------------------------------------
// Buffer GraphQL client
// ---------------------------------------------------------------------------

async function bufferGraphql<T = any>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(BUFFER_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BUFFER_API_KEY}`, // personal API key
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  if (res.status === 401) {
    throw new Error(
      "401 from Buffer — the BUFFER_API_KEY is missing/invalid (Settings -> API)."
    );
  }
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `Buffer API returned non-JSON (HTTP ${res.status}):\n${text.slice(0, 500)}`
    );
  }
  // GraphQL always returns HTTP 200; transport-level `errors` still possible.
  if (json.errors?.length) {
    throw new Error(
      `Buffer GraphQL errors:\n${JSON.stringify(json.errors, null, 2)}`
    );
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Queries / mutations  (verified shapes, post-2026-05-25 assets format)
// ---------------------------------------------------------------------------

// channels() requires an organizationId. Try to discover it from the account.
// If Buffer's schema names this differently, pass --org <id> to skip discovery.
const ORGS_QUERY = /* GraphQL */ `
  query Orgs {
    account {
      organizations {
        id
        name
      }
    }
  }
`;

const CHANNELS_QUERY = /* GraphQL */ `
  query GetChannels($input: ChannelsInput!) {
    channels(input: $input) {
      id
      name
      displayName
      service
      isQueuePaused
    }
  }
`;

// AssetInput is @oneOf: exactly one of video/image/document/link per element.
// createPost returns the PostActionPayload union.
const CREATE_POST_MUTATION = /* GraphQL */ `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess {
        post {
          id
          status
          text
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`;

// post() takes { input: { id } }; status enum is lowercase (draft|buffer|sent|error).
const POST_STATUS_QUERY = /* GraphQL */ `
  query PostStatus($input: PostInput!) {
    post(input: $input) {
      id
      status
      sentAt
      error {
        message
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function discoverOrgId(): Promise<string> {
  if (ORG_ID) return ORG_ID;
  try {
    const data = await bufferGraphql<{
      account: { organizations: Array<{ id: string; name: string }> };
    }>(ORGS_QUERY);
    const orgs = data.account?.organizations ?? [];
    const first = orgs[0];
    if (!first) throw new Error("no organizations on account");
    if (orgs.length > 1) {
      console.log(
        "Multiple organizations — using the first. Override with --org <id>:"
      );
      for (const o of orgs) console.log(`   ${o.id}  ${o.name}`);
    }
    return first.id;
  } catch (e: any) {
    throw new Error(
      `Could not auto-discover organizationId (${e.message}).\n` +
        `Pass it explicitly: --org <id>. Find it in Buffer's GraphQL explorer via the account/organizations query.`
    );
  }
}

async function listChannels() {
  const organizationId = await discoverOrgId();
  const data = await bufferGraphql<{
    channels: Array<{
      id: string;
      service: string;
      name: string;
      displayName: string;
      isQueuePaused: boolean;
    }>;
  }>(CHANNELS_QUERY, { input: { organizationId } });
  console.log(`\nConnected Buffer channels (org ${organizationId}):\n`);
  for (const c of data.channels ?? []) {
    console.log(
      `  ${String(c.service).padEnd(10)}  ${c.id}  ${c.displayName || c.name}${c.isQueuePaused ? "  (queue paused)" : ""}`
    );
  }
  const tiktok = (data.channels ?? []).find((c) => /tiktok/i.test(c.service));
  console.log(
    tiktok
      ? `\n  -> TikTok channel found: ${tiktok.id}  (pass with --channel ${tiktok.id})\n`
      : "\n  !! No TikTok channel visible via the API — connect TikTok in Buffer first, or the API doesn't expose it.\n"
  );
}

async function uploadToBlob(mp4Path: string): Promise<string> {
  const bytes = await readFile(mp4Path);
  const name = `cvm-tiktok-test/${Date.now()}-${basename(mp4Path)}`;
  console.log(
    `\nUploading ${basename(mp4Path)} (${(bytes.length / 1e6).toFixed(1)}MB) to Vercel Blob (public)...`
  );
  const blob = await put(name, bytes, {
    access: "public",
    token: BLOB_TOKEN, // optional; @vercel/blob falls back to env
    contentType: "video/mp4",
  });
  console.log(`  public URL: ${blob.url}`);
  return blob.url;
}

async function createPost(videoUrl: string, caption: string): Promise<string> {
  if (!CHANNEL_ID)
    throw new Error(
      "Missing --channel <tiktokChannelId> (run `npm run channels` first)."
    );
  const input = {
    channelId: CHANNEL_ID,
    text: caption,
    schedulingType: SCHEDULING, // automatic (auto-publish) | notification (reminder)
    mode: SHARE_NOW ? "shareNow" : "addToQueue",
    assets: [{ video: { url: videoUrl, metadata: { thumbnailOffset: 0 } } }],
  };
  console.log(
    `\nCalling createPost (schedulingType=${input.schedulingType}, mode=${input.mode})...`
  );
  const data = await bufferGraphql<any>(CREATE_POST_MUTATION, { input });
  const r = data.createPost;
  if (r.__typename === "MutationError") {
    throw new Error(`createPost -> MutationError: ${r.message}`);
  }
  const post = r.post;
  console.log(`  post created: id=${post.id}  status=${post.status}`);
  return post.id;
}

async function pollUntilTerminal(
  postId: string
): Promise<{ status: string; sentAt?: string; error?: string }> {
  const deadline = Date.now() + POLL_MINUTES * 60_000;
  const intervalMs = 15_000;
  console.log(
    `\nPolling post(${postId}).status (every 15s, up to ${POLL_MINUTES}min)...`
  );
  console.log(
    "  (Buffer fetches the video at PUBLISH time; a queued post may sit at `buffer` for hours.)"
  );
  while (Date.now() < deadline) {
    const data = await bufferGraphql<{
      post: { status: string; sentAt?: string; error?: { message: string } };
    }>(POST_STATUS_QUERY, { input: { id: postId } });
    const p = data.post;
    const status = String(p.status).toLowerCase();
    console.log(
      `  [${new Date().toISOString()}] status=${p.status}${p.error?.message ? ` error=${p.error.message}` : ""}`
    );
    if (status === "sent" || status === "error")
      return { status, sentAt: p.sentAt, error: p.error?.message };
    await sleep(intervalMs);
  }
  console.log(
    "  poll window elapsed without a terminal status (post likely queued/scheduled = `buffer`)."
  );
  return { status: "buffer" };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (LIST_CHANNELS) {
    await listChannels();
    return;
  }

  const mp4Path = cleanPositionals[0];
  const caption = cleanPositionals[1];
  if (!mp4Path || !caption) {
    console.error(
      [
        "",
        "Usage:",
        "  npm run channels [-- --org <id>]                        # list channels, find TikTok id",
        '  npm run validate -- <mp4> "<caption>" --channel <id> [options]',
        "",
        "Options:",
        "  --channel <id>        TikTok channel id (required for a post)",
        "  --org <id>            organization id (else auto-discovered)",
        "  --scheduling <mode>   automatic (auto-publish, default) | notification (reminder)",
        "  --share-now           mode: shareNow (else addToQueue)",
        "  --poll-minutes <n>    poll window (default 20)",
        "  --keep-blob           never delete the blob, even on sent",
        "",
        "Example:",
        '  npm run validate -- ~/Desktop/cvm-tiktok-test/big.mp4 "hello from CVM #test" \\',
        "      --channel 123 --scheduling automatic --share-now",
        "",
      ].join("\n")
    );
    process.exit(1);
  }

  const videoUrl = await uploadToBlob(mp4Path);
  const postId = await createPost(videoUrl, caption);
  const terminal = await pollUntilTerminal(postId);

  console.log("\n================ RESULT ================");
  console.log(
    `  requested   : schedulingType=${SCHEDULING}, mode=${SHARE_NOW ? "shareNow" : "addToQueue"}`
  );
  console.log(`  post status : ${terminal.status}`);
  if (terminal.sentAt) console.log(`  sentAt      : ${terminal.sentAt}`);
  if (terminal.error) console.log(`  error       : ${terminal.error}`);
  console.log("  CHECK ON TIKTOK:");
  console.log("   - did the post appear, and did the caption land verbatim?");
  console.log(
    "   - was it AUTO-PUBLISHED, or did Buffer create a REMINDER (manual finish in the Buffer app)?"
  );
  console.log(
    "   - if you asked for `automatic` but got a reminder, note it (original-audio requirement)."
  );
  console.log("========================================\n");

  if (terminal.status === "sent" && !KEEP_BLOB) {
    console.log(
      "status==sent -> deleting the blob (safe to delete on sent)..."
    );
    await del(videoUrl, { token: BLOB_TOKEN });
    console.log("  blob deleted.");
  } else {
    console.log(`Leaving blob live: ${videoUrl}`);
    console.log(
      "  (Buffer pulls bytes at PUBLISH time — keep it until status==sent, then delete.)"
    );
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err.message ?? err);
  process.exit(1);
});
