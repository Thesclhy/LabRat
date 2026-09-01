import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dataDirectory = path.dirname(fileURLToPath(import.meta.url));
const requestHelpers = [
  "serverApi.js",
  "analysisApi.js",
  "experimentBrowserApi.js",
];

describe("frontend API v1 cutover", () => {
  it("keeps every first-party request helper on the generated /api/v1 client", () => {
    for (const fileName of requestHelpers) {
      const source = fs.readFileSync(path.join(dataDirectory, fileName), "utf8");
      expect(source, fileName).toContain("backendApiV1Client.ts");
      expect(source, fileName).not.toMatch(/["'`]\/api\/(?!v1(?:\/|["'`]))/);
    }
  });

  it("keeps the generated path map checked in beside the typed client", () => {
    expect(fs.existsSync(path.join(dataDirectory, "backendApiV1Client.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dataDirectory, "generated", "backendApiV1.d.ts"))).toBe(true);
  });
});
