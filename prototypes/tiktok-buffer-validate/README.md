# TikTok Buffer transport validation (THROWAWAY — wayfinder #1278)

Validates the transport locked in
[#1277](https://github.com/mattpocock/course-video-manager/issues/1277):

```
render/pick .mp4  →  Vercel Blob (public URL)  →  Buffer GraphQL createPost(assets:[{video:{url}}], text)
                  →  poll post(id).status  →  delete blob on `sent`
```

Two questions it exists to answer (from
[#1278](https://github.com/mattpocock/course-video-manager/issues/1278)):

1. **Caption** — does the caption ride as the mutation's top-level `text` field
   and land on the TikTok post verbatim?
2. **Publish mode** — does it **auto-publish** (`schedulingType: automatic`) or
   fall back to a **reminder** (`notification`)? Buffer needs _original audio_
   for TikTok Direct-Post. Also: is the connected TikTok channel visible via the
   API at all?

This is throwaway research code — **do not merge to main**. It lives on a
throwaway branch only.

---

## What's automated vs. what you (Matt) do

- **Automated by the script:** blob upload, the `createPost` call, status polling,
  and blob cleanup on `sent`.
- **You provide + run:** the two secrets, then eyeball the TikTok result. Secrets
  are read from env only — the script never prints or commits them.

## Prerequisites (HITL — your accounts)

1. **Buffer personal API key** — Buffer → Settings → API → generate a personal
   key. (Confirmed mint-able on Free in [#1279](https://github.com/mattpocock/course-video-manager/issues/1279).)
2. **A TikTok channel connected in Buffer** — connect it in the Buffer UI first.
3. **Vercel Blob token** — `BLOB_READ_WRITE_TOKEN` from a Vercel project with Blob
   enabled (you have Vercel via AI Hero).
4. Test MP4s already on your machine: `~/Desktop/cvm-tiktok-test/` (incl. the
   141 MB / 75 s 1080×1920 one — the whole point is proving >100 MB works).

## Fastest path: the wizard

```bash
cd prototypes/tiktok-buffer-validate
./setup-wizard.sh
```

`setup-wizard.sh` walks you through all of it — opens Buffer + Vercel, captures
both secrets into a git-ignored `.env`, installs deps, runs `npm run channels`
to find the TikTok channel id, then (after a confirm) fires the post. Ctrl-C and
re-run any time; it remembers what you already entered. The manual steps below
are the same thing by hand.

## Run it by hand

```bash
cd prototypes/tiktok-buffer-validate
npm install

# secrets — set in your shell, do NOT commit (a leading space keeps them out of history)
 export BUFFER_API_KEY='...'          # note the leading space
 export BLOB_READ_WRITE_TOKEN='...'

# 1) find your TikTok channel id (also answers "is the channel visible via API?")
npm run channels
#   -> prints each channel's service + id, and flags the TikTok one.
#   If org auto-discovery fails, it'll tell you to pass:  npm run channels -- --org <id>

# 2) post the big (>100MB) clip, asking for auto-publish, share now
npm run validate -- ~/Desktop/cvm-tiktok-test/big.mp4 "CVM test — auto-publish #test" \
    --channel <tiktokChannelId> --scheduling automatic --share-now
```

The script uploads → creates the post → polls `post(id).status` (every 15 s, up
to `--poll-minutes`, default 20). Buffer fetches the bytes **at publish time**,
so a _queued_ post can sit at status `buffer` for a while; if `--share-now`
publishes promptly you should see it reach `sent`.

### Options

| flag                                   | meaning                                    |
| -------------------------------------- | ------------------------------------------ |
| `--channel <id>`                       | TikTok channel id (required to post)       |
| `--org <id>`                           | organization id (else auto-discovered)     |
| `--scheduling automatic\|notification` | request auto-publish (default) vs reminder |
| `--share-now`                          | `mode: shareNow` (else `addToQueue`)       |
| `--poll-minutes <n>`                   | poll window, default 20                    |
| `--keep-blob`                          | never auto-delete the blob, even on `sent` |

### Suggested runs to settle #1278

1. **Auto-publish path** — `--scheduling automatic --share-now` on the 141 MB clip
   (has original audio). Watch whether it reaches `sent` on its own **or** Buffer
   makes a reminder you must finish in the app.
2. **Reminder path (comparison)** — same clip, `--scheduling notification`. Confirm
   the caption still lands and the post shows up as a reminder.

## What to observe & report back (paste into #1278)

- [ ] Is the **TikTok channel** listed by `npm run channels`? (Y/N + its id)
- [ ] Did **>100 MB** upload to Blob and get accepted by `createPost`? (the whole reason for this transport)
- [ ] Did the **caption** appear on the TikTok post **verbatim**? Any truncation/hashtag handling?
- [ ] With `--scheduling automatic`, did it **AUTO-PUBLISH** to `sent`, or become a **REMINDER**?
- [ ] Terminal `status` (`sent` / `error` / stuck at `buffer`) + any `error.message`.
- [ ] Did blob deletion on `sent` work (or did you keep it)?

## Notes / caveats baked into the script

- Endpoint is the **root** `https://api.buffer.com` (POST), not `/graphql`.
- `assets` uses the **post-2026-05-25** `@oneOf` format: `[{ video: { url, metadata:{ thumbnailOffset } } }]`.
- `PostStatus` enum is **lowercase** (`draft | buffer | sent | error`); the script lower-cases before comparing.
- `error` on a post is an **object** (`{ message }`), not a string — verify the field
  selection in Buffer's explorer if it complains (`PostPublishingError` shape was the one
  under-documented spot).
- If `Authorization: Bearer <key>` is rejected, try the bare key without `Bearer`.
