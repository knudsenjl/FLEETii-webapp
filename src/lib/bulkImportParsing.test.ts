import { describe, expect, it } from "vitest";
import { parseImportFile } from "./bulkImportParsing";

describe("parseImportFile", () => {
  describe("csv", () => {
    it("parses a header row and data rows into objects", () => {
      const csv = "Email,Navn\nanna@example.dk,Anna\nbo@example.dk,Bo";
      expect(parseImportFile(csv, "csv")).toEqual([
        { Email: "anna@example.dk", Navn: "Anna" },
        { Email: "bo@example.dk", Navn: "Bo" },
      ]);
    });

    it("trims whitespace around headers and values", () => {
      const csv = "Email, Navn \n anna@example.dk , Anna ";
      expect(parseImportFile(csv, "csv")).toEqual([{ Email: "anna@example.dk", Navn: "Anna" }]);
    });

    it("skips blank lines", () => {
      const csv = "Email,Navn\nanna@example.dk,Anna\n\n";
      expect(parseImportFile(csv, "csv")).toHaveLength(1);
    });

    it("throws a Danish error for malformed CSV", () => {
      // An unterminated quoted field is a real papaparse parse error, not
      // just an empty result.
      const csv = 'Email,Navn\n"anna@example.dk,Anna';
      expect(() => parseImportFile(csv, "csv")).toThrow(/Ugyldig CSV-fil/);
    });
  });

  describe("json", () => {
    it("parses a JSON array of objects", () => {
      const json = JSON.stringify([{ Email: "anna@example.dk", Navn: "Anna" }]);
      expect(parseImportFile(json, "json")).toEqual([{ Email: "anna@example.dk", Navn: "Anna" }]);
    });

    it("throws for malformed JSON", () => {
      expect(() => parseImportFile("{not valid", "json")).toThrow();
    });

    it("throws when the top level isn't an array", () => {
      expect(() => parseImportFile(JSON.stringify({ Email: "a@b.dk" }), "json")).toThrow();
    });

    it("throws when an array element isn't an object", () => {
      expect(() => parseImportFile(JSON.stringify(["a", "b"]), "json")).toThrow();
    });
  });
});
