export const STORAGE_KEY = "spacedesk-ip-suffix";
const PREFIX = "192.168.";

export function buildFullIp(suffix: string): string {
  return `${PREFIX}${suffix}`;
}

export function isValidSuffix(suffix: string): boolean {
  const parts = suffix.split(".");
  if (parts.length !== 2) return false;
  return parts.every((p) => {
    if (p === "" || !/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}
