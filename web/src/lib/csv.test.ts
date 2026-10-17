import { afterEach, describe, expect, it, vi } from "vitest";

import { csvFilename, downloadCsv, toCsv } from "./csv";

describe("csv", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("quotes only the fields that need it, RFC 4180 style", () => {
    expect(
      toCsv([
        ["word", "count"],
        ["cat", 63],
        ["a,b", 2],
        ['say "hi"', 1],
        ["two\nlines", 1],
      ]),
    ).toBe('word,count\r\ncat,63\r\n"a,b",2\r\n"say ""hi""",1\r\n"two\nlines",1');
  });

  it("turns a panel title into a filename", () => {
    expect(csvFilename("Words that lift")).toBe("words-that-lift.csv");
    expect(csvFilename("Who says “cat”")).toBe("who-says-cat.csv");
    expect(csvFilename("!!!")).toBe("export.csv");
  });

  it("hands the file to the browser and reports the data-row count", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const createObjectURL = vi.fn(() => "blob:rows");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

    const written = downloadCsv("Words that lift", [["word", "count"], ["cat", 63]]);

    expect(written).toBe(1);
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});
