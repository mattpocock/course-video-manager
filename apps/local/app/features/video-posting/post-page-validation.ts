export function validateYoutubeTitle(value: string): string | null {
  const nonEmptyLines = value
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (nonEmptyLines.length > 1) {
    return "YouTube title must be a single line";
  }

  return null;
}
