import { Args, Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import nodePath from "node:path";
import { pathToFileURL } from "node:url";
import { FrameCaptureError } from "@/services/frame-capture-service";
import { detail, emitNdjson, parseError } from "@/cli/helpers";
import {
  NEEDS_CLIP_MOCKUP_DIRECTORY,
  requireLocalMachine,
} from "@/cli/local-only";
import { capturePages } from "./clip-mockup.batch";
import { CAPTURE_HELP } from "./clip-mockup.help";

/**
 * `cvm clip-mockup capture`: turn pages into PNGs and do NOTHING else — no
 * row, no speech, no Clip Mockup store. It is the authoring loop's "look at
 * it" step: write a page, capture it, read the PNG, rewrite the page, and
 * only `add` once the picture is right.
 *
 * It goes through `capturePages`, the one path `add` and `update` use, so a
 * frame captured here is byte for byte the frame `add` would store: the same
 * browser, the same 1920x1080 viewport, the same wait for web fonts.
 *
 * THE CONTACT SHEET. `--sheet` also writes ONE PNG of every page as a grid of
 * labelled tiles, so an agent checks a run of Reveals with one image read
 * instead of one per page. The sheet is itself an HTML page captured by the
 * same browser — no image library, nothing new to install.
 */

const ENTITY = "clipMockup";

/** Tiles per row on the contact sheet. */
export const SHEET_COLUMNS = 3;
/** The gap between tiles and around the sheet, in px. */
const SHEET_GAP = 24;
/** Each tile's width: three across a 1920px sheet, 16:9 like the frame. */
export const SHEET_TILE_WIDTH =
  (1920 - SHEET_GAP * (SHEET_COLUMNS + 1)) / SHEET_COLUMNS;

const escapeHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * The contact sheet page: every PNG in the order given, 3 across, each tile
 * headed by its 1-based index and its page's file name.
 */
const contactSheetHtml = (
  tiles: ReadonlyArray<{ readonly png: string; readonly html: string }>
) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; }
body { margin: 0; width: 1920px; background: #101011; color: #d6d3d1;
  font: 22px/1.3 ui-monospace, "Fira Code", Menlo, monospace; }
.grid { display: grid; gap: ${SHEET_GAP}px; padding: ${SHEET_GAP}px;
  grid-template-columns: repeat(${SHEET_COLUMNS}, ${SHEET_TILE_WIDTH}px); }
.tile { margin: 0; }
.tile figcaption { padding: 0 0 8px; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.tile b { color: #fbbf24; margin-right: 12px; }
.tile img { display: block; width: ${SHEET_TILE_WIDTH}px;
  aspect-ratio: 16 / 9; outline: 1px solid #2a2a2a; }
</style></head><body><div class="grid">
${tiles
  .map(
    (tile, i) =>
      `<figure class="tile"><figcaption><b>${i + 1}</b>${escapeHtml(
        nodePath.basename(tile.html)
      )}</figcaption><img src="${pathToFileURL(tile.png).href}"></figure>`
  )
  .join("\n")}
</div></body></html>
`;

/** `page.html` -> `page.png`, beside it. Only an .html / .htm page is taken. */
const pngBeside = (html: string) =>
  nodePath.join(
    nodePath.dirname(html),
    `${nodePath.basename(html, nodePath.extname(html))}.png`
  );

/**
 * The contract is `capture <page.html>... [--sheet <sheet.png>]` — the flag
 * AFTER the pages, which is where an agent listing a glob writes it. The rest
 * of `cvm` takes flags before positionals, and @effect/cli reads a flag after
 * a repeated argument as one more argument. So a trailing `--sheet <path>` (or
 * `--sheet=<path>`) is picked out of the page list here; `--sheet` before the
 * pages still works through the option.
 */
const splitTrailingSheet = (tokens: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const pages: string[] = [];
    let sheet: string | undefined;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      let value: string | undefined;
      if (token === "--sheet") {
        value = tokens[++i];
        if (value === undefined) {
          return yield* parseError("--sheet needs a <sheet.png> path", ENTITY);
        }
      } else if (token.startsWith("--sheet=")) {
        value = token.slice("--sheet=".length);
      } else if (token.startsWith("--")) {
        return yield* parseError(
          `unknown flag ${token}; capture takes only --sheet <sheet.png>`,
          ENTITY
        );
      } else {
        pages.push(token);
        continue;
      }
      if (sheet !== undefined) {
        return yield* parseError("give --sheet once", ENTITY);
      }
      sheet = value;
    }
    return { pages, sheet };
  });

const pagesArg = Args.text({ name: "page.html" }).pipe(Args.repeated);

const sheetOption = Options.text("sheet").pipe(
  Options.withDescription(
    "Also write ONE contact sheet PNG here: every page in the order given, 3 across, each tile labelled with its 1-based index and file name."
  ),
  Options.optional
);

export const captureCmd = Command.make(
  "capture",
  { pages: pagesArg, sheet: sheetOption },
  ({ pages: tokens, sheet: sheetBefore }) =>
    Effect.gen(function* () {
      // Local-only like every other verb here: the browser is on this machine.
      yield* requireLocalMachine(
        "cvm clip-mockup",
        NEEDS_CLIP_MOCKUP_DIRECTORY
      );

      const { pages, sheet: sheetAfter } = yield* splitTrailingSheet(tokens);
      if (Option.isSome(sheetBefore) && sheetAfter !== undefined) {
        return yield* parseError("give --sheet once", ENTITY);
      }
      const sheet = Option.orElse(sheetBefore, () =>
        Option.fromNullable(sheetAfter)
      );

      if (pages.length === 0) {
        return yield* parseError(
          "give at least one <page.html> to capture",
          ENTITY
        );
      }

      // Every argument is checked before the browser is asked for anything:
      // a typo in page 40 must not cost 39 captures.
      const fs = yield* FileSystem.FileSystem;
      const htmls = pages.map((p) => nodePath.resolve(p));
      for (const html of htmls) {
        if (![".html", ".htm"].includes(nodePath.extname(html).toLowerCase())) {
          return yield* parseError(
            `${html} is not an .html page; capture writes <page>.png beside <page>.html`,
            ENTITY
          );
        }
        const exists = yield* fs
          .exists(html)
          .pipe(Effect.orElseSucceed(() => false));
        if (!exists) {
          return yield* parseError(`cannot read page ${html}`, ENTITY);
        }
      }
      const sheetPath = Option.map(sheet, (s) => nodePath.resolve(s));
      if (
        Option.isSome(sheetPath) &&
        nodePath.extname(sheetPath.value).toLowerCase() !== ".png"
      ) {
        return yield* parseError(
          `--sheet ${sheetPath.value} must be a .png path`,
          ENTITY
        );
      }

      const rows = htmls.map((html) => ({ html, png: pngBeside(html) }));

      // A page named twice is captured once; it still gets a tile per mention.
      const distinct = [...new Map(rows.map((r) => [r.html, r])).values()];
      yield* capturePages(
        distinct.map((r) => ({
          htmlPath: r.html,
          outputPath: r.png,
          fullPage: false,
        }))
      );

      if (Option.isSome(sheetPath)) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const fail = (cause: unknown, message: string) =>
              new FrameCaptureError({ htmlPath: "", cause, message });
            const scratch = yield* fs
              .makeTempDirectoryScoped({ prefix: "cvm-contact-sheet-" })
              .pipe(
                Effect.mapError((cause) =>
                  fail(cause, "could not make a temp directory for the sheet")
                )
              );
            const sheetHtml = nodePath.join(scratch, "sheet.html");
            yield* fs.writeFileString(sheetHtml, contactSheetHtml(rows)).pipe(
              Effect.zipRight(
                fs.makeDirectory(nodePath.dirname(sheetPath.value), {
                  recursive: true,
                })
              ),
              Effect.mapError((cause) =>
                fail(cause, `could not prepare the sheet ${sheetPath.value}`)
              )
            );
            yield* capturePages([
              {
                htmlPath: sheetHtml,
                outputPath: sheetPath.value,
                fullPage: true,
              },
            ]);
          })
        );
      }

      yield* emitNdjson([
        ...rows,
        ...(Option.isSome(sheetPath) ? [{ sheet: sheetPath.value }] : []),
      ]);
    })
).pipe(Command.withDescription(detail(CAPTURE_HELP)));
