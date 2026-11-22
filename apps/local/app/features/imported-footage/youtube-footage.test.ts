import { describe, expect, it } from "vitest";
import { youtubeFootageName } from "./youtube-footage";

describe("youtubeFootageName", () => {
  it("turns each character Windows refuses into a space", () => {
    expect(youtubeFootageName('a<b>c:d"e/f\\g|h?i*j', "id1")).toBe(
      "a b c d e f g h i j [id1].mp4"
    );
  });

  it("turns control codes, DEL and C1 controls included, into spaces", () => {
    expect(youtubeFootageName("a\u0000b\tc\u001fd\u007fe\u009ff", "id1")).toBe(
      "a b c d e f [id1].mp4"
    );
  });

  it("keeps letters outside ASCII", () => {
    expect(youtubeFootageName("Café – naïve 日本", "id1")).toBe(
      "Café – naïve 日本 [id1].mp4"
    );
  });

  it("drops trailing dots and spaces, and names an empty title", () => {
    expect(youtubeFootageName("Wait... ", "id1")).toBe("Wait [id1].mp4");
    expect(youtubeFootageName("\u0001?*", "id1")).toBe(
      "YouTube video [id1].mp4"
    );
  });
});
