import path from "node:path";

const ROOT_VIDEO_DIR = `/mnt/d/finished-videos`;

export const getVideoPath = (videoId: string) =>
  path.join(ROOT_VIDEO_DIR, videoId + ".mp4");

const ROOT_TRANSCRIPT_DIR = `/mnt/d/transcripts`;

export const getVideoTranscriptPath = (originalVideoPath: string) => {
  const basename = path.parse(originalVideoPath).name;
  const transcriptPath = path.join(
    ROOT_TRANSCRIPT_DIR,
    basename + ".transcript.json"
  );
  console.log(transcriptPath);
  return transcriptPath;
};
