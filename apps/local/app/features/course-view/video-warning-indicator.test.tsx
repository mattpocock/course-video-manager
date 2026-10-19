import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VideoWarning } from "@/services/video-warnings";
import {
  DEFAULT_VISIBILITY,
  resolveEffectiveVisibility,
} from "./course-view-visibility";
import { VideoWarningIndicator } from "./video-warning-indicator";

const render = (props: {
  warnings: VideoWarning[];
  isReadOnly?: boolean;
  visible?: boolean;
}) =>
  renderToStaticMarkup(
    <VideoWarningIndicator
      warnings={props.warnings}
      isReadOnly={props.isReadOnly ?? false}
      visible={props.visible ?? true}
    />
  );

describe("VideoWarningIndicator", () => {
  it("names each of the video's warnings in plain words", () => {
    const html = render({
      warnings: [{ kind: "missingBody" }, { kind: "duplicateQuizId" }],
    });
    expect(html).toContain(
      'aria-label="Video warnings: Missing lesson body; Duplicate quiz id"'
    );
  });

  it("renders nothing for a video with no warnings", () => {
    expect(render({ warnings: [] })).toBe("");
  });

  it("renders nothing on a read-only (old) course version", () => {
    expect(
      render({ warnings: [{ kind: "missingBody" }], isReadOnly: true })
    ).toBe("");
  });

  it("renders nothing when the Video warnings toggle is off", () => {
    const visible = resolveEffectiveVisibility({
      ...DEFAULT_VISIBILITY,
      videoWarnings: false,
    }).videoWarnings;
    expect(render({ warnings: [{ kind: "missingBody" }], visible })).toBe("");
  });
});
