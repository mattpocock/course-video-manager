export function getVideoPath(opts: {
  videoCount: number;
  hasExplainerFolder: boolean;
}) {
  if (opts.hasExplainerFolder) {
    if (opts.videoCount === 0) {
      return "Explainer";
    } else {
      return `Explainer ${opts.videoCount + 1}`;
    }
  }

  if (opts.videoCount === 0) {
    return "Problem";
  } else if (opts.videoCount === 1) {
    return "Solution";
  } else {
    return `Solution ${opts.videoCount}`;
  }
}
