import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("authentication return paths", () => {
  it("preserves an internal scan path and query", () => expect(safeReturnPath("/s/abc?source=camera")).toBe("/s/abc?source=camera"));
  it.each(["https://example.com", "//example.com", "/\\example.com", "/safe\nlocation", null])("rejects unsafe return value %s", (value) => expect(safeReturnPath(value)).toBe("/"));
});
