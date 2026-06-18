import { toSlug } from "@/services/lesson-path-service";

export const courseNameToSlug = (name: string): string => {
  return toSlug(name);
};
