const AI_HERO_URL_REGEX = /https?:\/\/(?:www\.)?aihero\.dev[^\s)>]*/g;
const AI_HERO_URL_TEST = /https?:\/\/(?:www\.)?aihero\.dev[^\s)>]*/;
const SHORT_LINK_REGEX = /^https?:\/\/(?:www\.)?aihero\.dev\/s\//;

export function hasAiHeroUrls(text: string): boolean {
  return AI_HERO_URL_TEST.test(text);
}

export function findConvertibleAiHeroUrls(text: string): string[] {
  const matches = text.match(AI_HERO_URL_REGEX);
  if (!matches) return [];
  return [...new Set(matches)].filter((url) => !SHORT_LINK_REGEX.test(url));
}

export function replaceUrls(
  text: string,
  replacements: Map<string, string>
): string {
  let result = text;
  for (const [original, replacement] of replacements) {
    result = result.replaceAll(original, replacement);
  }
  return result;
}
