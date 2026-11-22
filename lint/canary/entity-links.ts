export const copy = (video: { id: string }): Promise<void> =>
  navigator.clipboard.writeText(video.id);

export const base = (): string => window.location.origin;
