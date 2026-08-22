import assert from "node:assert/strict";
import test from "node:test";
import { csvRecords, parseCsv } from "./csv-parser.mjs";

test("parses quoted commas, quotes, and newlines", () => {
  assert.deepEqual(parseCsv('name,notes\r\n"Mira, K","Line 1\nLine ""2"""\r\n'), [["name", "notes"], ["Mira, K", 'Line 1\nLine "2"']]);
});

test("maps normalized headers to row values", () => {
  assert.deepEqual(csvRecords(" Name ,Phone\nMira,9876543210\n"), [{ rowNumber: 2, values: { name: "Mira", phone: "9876543210" } }]);
});

test("rejects an unclosed quoted field", () => assert.throws(() => parseCsv('name\n"Mira'), /unclosed/));
