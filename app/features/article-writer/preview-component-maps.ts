/**
 * The custom tags a preview renders.
 *
 * Quizzes and commit maps render in every document preview: a body carrying
 * one shows it whatever mode wrote it. Screenshot placeholders need clips to
 * resolve to, so they come as a separate map.
 *
 * Module constants, and they must stay constants: react-markdown uses a mapped
 * value as the React element *type*, so a fresh object on each render unmounts
 * and remounts every card.
 */

import type { Options } from "react-markdown";
import { CHOOSE_SCREENSHOT_COMPONENTS } from "./choose-screenshot-components";
import { COMMIT_MAP_COMPONENTS } from "./commit-map-components";
import { QUIZ_COMPONENTS } from "./quiz-components";

export const PREVIEW_COMPONENTS = {
  ...QUIZ_COMPONENTS,
  ...COMMIT_MAP_COMPONENTS,
} as Options["components"];

export const PREVIEW_COMPONENTS_WITH_SCREENSHOTS = {
  ...PREVIEW_COMPONENTS,
  ...CHOOSE_SCREENSHOT_COMPONENTS,
} as Options["components"];
