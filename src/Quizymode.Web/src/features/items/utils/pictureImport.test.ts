import { describe, expect, it } from "vitest";
import { findPictureImportError } from "./pictureImport";

const picture = { key: "curated:flags/fr", altText: "Three bands" };
const HINT =
  "Only your own uploaded asset references can be imported. Curated keys, URLs, bytes and other authors' pictures cannot be imported.";

describe("findPictureImportError", () => {
  it("accepts rows without picture fields and rows that carry null (an exported file)", () => {
    expect(findPictureImportError([{ question: "Q" }, { questionImage: null, explanationImage: null }])).toBeNull();
    expect(findPictureImportError([{ questionImage: undefined }])).toBeNull();
  });

  it("names the one item and the field that was found", () => {
    expect(findPictureImportError([{}, {}, { questionImage: picture }])).toBe(`Item 3 has "questionImage". ${HINT}`);
    expect(findPictureImportError([{ explanationImage: picture }])).toBe(`Item 1 has "explanationImage". ${HINT}`);
    expect(findPictureImportError([{ questionImage: picture, explanationImage: picture }])).toBe(
      `Item 1 has "questionImage" and "explanationImage". ${HINT}`,
    );
  });

  it("lists up to three items, then counts the rest", () => {
    const rows = Array.from({ length: 12 }, (_, index) => (index % 2 === 0 ? { questionImage: picture } : {}));
    expect(findPictureImportError(rows.slice(0, 5))).toBe(`Items 1, 3 and 5 have "questionImage". ${HINT}`);
    expect(findPictureImportError(rows.slice(0, 3))).toBe(`Items 1 and 3 have "questionImage". ${HINT}`);
    expect(findPictureImportError(rows)).toBe(`Items 1, 3, 5 and 3 more have "questionImage". ${HINT}`);
  });

  it("names both fields when items differ, and treats a non-object value as a picture", () => {
    expect(findPictureImportError([{ questionImage: picture }, { explanationImage: picture }])).toBe(
      `Items 1 and 2 have "questionImage" or "explanationImage". ${HINT}`,
    );
    expect(findPictureImportError([{ questionImage: "curated:flags/fr" }])).toContain('Item 1 has "questionImage"');
  });

  it("ignores rows that are not objects", () => {
    expect(findPictureImportError([null, "text", 4])).toBeNull();
  });
});
