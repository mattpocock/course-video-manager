import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import entityLinks from "./entity-links.js";

RuleTester.describe = describe;
RuleTester.it = it;

const clipboard = { messageId: "clipboard" };
const origin = { messageId: "origin" };

new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
}).run("entity-links", entityLinks, {
  valid: [
    "await navigator.clipboard.writeText(entityDeepLink(entity, base));",
    "await navigator.clipboard.writeText(link);",
    "await navigator.clipboard.writeText(text);",
    "await navigator.clipboard.writeText(props.command);",
    "await navigator.clipboard.writeText(errorDetails.join('\\n'));",
    "await navigator.clipboard.writeText(video.title);",
    "await navigator.clipboard.writeText(video.identifier);",
    "await navigator.clipboard.writeText(deviceFlow.userCode);",
    "await navigator.clipboard.writeText(void0Id());",
    "await navigator.clipboard.writeText(ID);",
    "await navigator.clipboard.writeText('/api/videos/1');",
    "await navigator.clipboard.writeText(`https://example.com/videos/${id}`);",
    "await navigator.clipboard.writeText(`${a}${b}/videos/${id}`);",
    "await navigator.clipboard.writeText(`/settings`);",
    "await navigator.clipboard.writeText('videos/' + id);",
    "await navigator.clipboard.writeText(prefix + '/videos/' + id);",
    "await navigator.clipboard.write([item]);",
    "await navigator.clipboard.readText();",
    "await other.writeText(video.id);",
    "await writeText(video.id);",
    "const path = `/videos/${videoId}`;",
    "navigate(`/videos/${video.id}`);",
    "const href = window.location.href;",
    "const o = url.origin;",
    "const o = allocation.origin;",
    "const o = new URL(request.url).origin;",
    "const { href } = window.location;",
    "const { origin } = url;",
    "// window.location.origin\nconst x = 1;",
    "const s = 'clipboard.writeText(video.id) and location.origin';",
  ],
  invalid: [
    {
      code: "await navigator.clipboard.writeText(video.id);",
      errors: [clipboard],
    },
    {
      code: "await navigator.clipboard.writeText(videoId);",
      errors: [clipboard],
    },
    {
      code: "await navigator.clipboard.writeText(props.lessonId);",
      errors: [clipboard],
    },
    { code: "await navigator.clipboard.writeText(id);", errors: [clipboard] },
    {
      code: "await navigator.clipboard.writeText(clip?.id);",
      errors: [clipboard],
    },
    {
      code: "await navigator.clipboard.writeText(video['id']);",
      errors: [clipboard],
    },
    {
      code: "await navigator.clipboard.writeText(video.id as string);",
      errors: [clipboard],
    },
    {
      code: "await navigator.clipboard.writeText(video.id!);",
      errors: [clipboard],
    },
    {
      code: "await navigator.clipboard.writeText((videoId));",
      errors: [clipboard],
    },
    {
      code: "await navigator.clipboard.writeText(`/videos/${id}`);",
      errors: [clipboard],
    },
    {
      code: "await navigator.clipboard.writeText(`/courses/${c}/sections/${s}`);",
      errors: [clipboard],
    },
    {
      code: "await navigator.clipboard.writeText('/pitches/' + pitch.slug);",
      errors: [clipboard],
    },
    {
      code: 'await navigator.clipboard.writeText("/diagram-playground/" + d);',
      errors: [clipboard],
    },
    {
      code: "await navigator.clipboard.writeText(`${base}/videos/${video.slug}`);",
      errors: [clipboard],
    },
    {
      code: "await navigator.clipboard.writeText(`/videos/` + a + b);",
      errors: [clipboard],
    },
    { code: "void clipboard.writeText(video.id);", errors: [clipboard] },
    {
      code: "void window.navigator.clipboard.writeText(videoId).then(done);",
      errors: [clipboard],
    },
    {
      code: "void navigator.clipboard['writeText'](videoId);",
      errors: [clipboard],
    },
    {
      code: "void navigator?.clipboard?.writeText(videoId);",
      errors: [clipboard],
    },
    {
      code: "await navigator.clipboard.writeText(\n  video.id\n);",
      errors: [clipboard],
    },
    {
      code: "<button onClick={() => navigator.clipboard.writeText(video.id)} />;",
      errors: [clipboard],
    },
    { code: "const base = location.origin;", errors: [origin] },
    { code: "const base = window.location.origin;", errors: [origin] },
    { code: "const base = document.location.origin;", errors: [origin] },
    { code: "const base = window.location['origin'];", errors: [origin] },
    { code: "const base = globalThis.location?.origin;", errors: [origin] },
    { code: "const { origin } = window.location;", errors: [origin] },
    { code: "const { origin: o } = location;", errors: [origin] },
    {
      code: "navigator.clipboard.writeText(`${window.location.origin}/videos/${id}`);",
      errors: [clipboard, origin],
    },
  ],
});
