import { describe, expect, it } from "vitest";

import { schemaWarning } from "./schemaWarning";

describe("schemaWarning", () => {
  it("returns the sentence when the payload carries one", () => {
    expect(
      schemaWarning({
        schema_version: null,
        schema_expected: 1,
        schema_message: "This database was built by an older revision.",
      }),
    ).toBe("This database was built by an older revision.");
  });

  it("returns null when the versions agree", () => {
    expect(schemaWarning({ schema_version: 1, schema_expected: 1, schema_message: null })).toBeNull();
  });

  it("returns null for a payload written before the field existed", () => {
    expect(schemaWarning({ timezone_mismatch: false })).toBeNull();
  });

  it("returns null for a blank or wrong-typed message rather than rendering it", () => {
    expect(schemaWarning({ schema_message: "" })).toBeNull();
    expect(schemaWarning({ schema_message: "   " })).toBeNull();
    expect(schemaWarning({ schema_message: 42 })).toBeNull();
    expect(schemaWarning({ schema_message: {} })).toBeNull();
  });

  it("survives a meta that is not an object", () => {
    expect(schemaWarning(null)).toBeNull();
    expect(schemaWarning(undefined)).toBeNull();
    expect(schemaWarning("nope")).toBeNull();
  });
});
