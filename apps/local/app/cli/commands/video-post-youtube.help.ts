/** `cvm video post-youtube --help`: see GLOSSARY.md (YouTube Draft, Thumbnail, Exported Video). */
export const POST_YOUTUBE_HELP = `Upload a Landscape Video to YouTube, UNLISTED or PRIVATE, with a Thumbnail made
in the CVM: queue the same 'youtube' Sidecar Job the Video's Post page queues
when Post is pressed. This command uploads nothing itself; the Sidecar does.

WHAT GOES UP
  The file      the Video's Exported Video (finished-videos/ on a Storage
                Root). A Video that is not exported is refused: export it
                from the Video's page in the CVM first.
  Title and     the Video's YouTube Draft, as typed on its Post page (a title
  description   never typed falls back to its Pitch's YouTube title, as the
                page does). Empty, or something YouTube refuses (< or >, a
                title over 100 characters), is refused.
  Thumbnail     --thumbnail <id>: one of THIS Video's Thumbnails, made on its
                Thumbnail page, rendered, not deleted, and its file on disk
                ('cvm thumbnail list --video <id>' lists them). There is no way
                to send any other image: no flag takes a path.
  Privacy       --privacy unlisted (the default) or private. Never public:
                'public' is refused by the parser (exit 3). Make it public
                in YouTube Studio once it has been checked.

Every refusal is exit 3 and queues nothing: ThumbnailNotUploadableError (its
'reason' is not-found, other-video, no-file or archived), or ParseError (not
exported, no YouTube Draft, a Short, an archived Video, an upload of this
Video already queued or running). A Short is refused: Shorts go out through
the Posting Queue ('cvm short post').

A POSTING JOB
  It runs ONCE. A run cut off mid-upload ends interrupted and is never run
  again on its own: it may or may not have reached YouTube, so check Studio
  before posting again. The Sidecar must be running ('pnpm dev' or 'pnpm
  start'); until it is, the Job waits in the queue. YouTube must be
  connected on the Post page, or the Job fails without sending anything.

LOCAL-ONLY
  The Sidecar on the author's machine sends the export and the Thumbnail
  from its disk. Anywhere else this is refused first: exit 7, _tag
  "LocalOnlyCommandError".

FLAGS
  --thumbnail <id>   (required) the CVM Thumbnail id
  --privacy <p>      unlisted (default) | private
  --dry-run          print everything it would queue, and queue nothing
  --wait             wait for the Job to settle (as 'cvm job wait' does)
  --timeout <min>    with --wait: give up waiting after this many minutes
                     (the upload carries on)

OUTPUT
  One pretty JSON object. --dry-run: { dryRun: true, videoId, title,
  description, privacyStatus, export: { path, sizeBytes }, thumbnail: { id,
  path, selectedForUpload } }. Otherwise the same with jobId, status "queued"
  and log instead of dryRun — follow it with 'cvm job wait <jobId>'. With
  --wait: the settled Job as 'cvm job get' prints it; 'posted' holds
  { youtubeVideoId, url }. A failed upload is JobFailedError, exit 4.

EXAMPLES
  cvm thumbnail list --video <videoId>
  cvm video post-youtube --thumbnail <thumbnailId> --dry-run <videoId>
  cvm video post-youtube --thumbnail <thumbnailId> --privacy private --wait <videoId>`;
