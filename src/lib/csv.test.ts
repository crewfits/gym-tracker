import { describe, expect, it } from "vitest";
import { csvCell, csvDocument } from "./csv";

describe("CSV export", () => {
  it("escapes commas, quotes and newlines", () => {
    expect(csvCell('Crew, "Fit"\nGym')).toBe('"Crew, ""Fit""\nGym"');
  });
  it("writes an Excel-friendly UTF-8 document", () => {
    expect(csvDocument(["Name", "Phone"], [["Mira", "9876543210"]])).toBe("\uFEFFName,Phone\r\nMira,9876543210\r\n");
  });
});
